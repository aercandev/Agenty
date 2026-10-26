// Bir istemi seçilen moda göre (tekli, analiz → kodlama, paralel) CLI çalıştırmalarına dönüştürür
// ve sonuçları oturuma işler.

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type {
  ChangedFile,
  ModelRef,
  Permission,
  Run,
  RunDelta,
  RunEvent,
  RunRole,
  Session,
  StartTurnRequest,
  Turn
} from '../shared/types.ts'
import { execCapture, resolveEnv } from './env.ts'
import { createParser, type ParsedEvent } from './parsers.ts'
import { getProvider, resolveBinary } from './providers.ts'
import { runCli, type RunHandle } from './runner.ts'
import type { Store } from './store.ts'

export interface OrchestratorEvents {
  delta(d: RunDelta): void
  session(s: Session): void
  list(): void
}

interface ActiveTurn {
  handles: Set<RunHandle>
  cancelled: boolean
  approve?: (ok: boolean) => void
}

interface PendingDelta {
  text: string
  events: RunEvent[]
  timer?: NodeJS.Timeout
}

const MAX_EVENTS = 400
const HISTORY_CHARS = 2500

export const ANALYSIS_PROMPT = `Rolün: ANALİZ AJANI.
Aşağıdaki isteği incele. Hiçbir dosyayı değiştirme. Gerekirse çalışma klasöründeki ilgili dosyaları oku.
Çıktın başka bir kodlama ajanı tarafından uygulanacak net bir teknik plan olmalı:
1. Gereksinimlerin özeti ve varsayımlar
2. Etkilenecek / oluşturulacak dosyalar
3. Adım adım uygulama planı
4. Riskler ve dikkat edilmesi gereken noktalar
5. Doğrulama / test önerileri`

export const CODING_PROMPT = `Rolün: KODLAMA AJANI.
Aşağıdaki kullanıcı isteğini, analiz ajanının hazırladığı plana göre çalışma klasöründe uygula.
Plan ile kod tabanı çelişirse kod tabanını esas al ve nedenini belirt. İş bitince yaptığın değişiklikleri kısaca özetle.`

export class Orchestrator {
  private active = new Map<string, ActiveTurn>()
  private pending = new Map<string, PendingDelta>()
  private store: Store
  private events: OrchestratorEvents

  constructor(store: Store, events: OrchestratorEvents) {
    this.store = store
    this.events = events
  }

  isRunning(): boolean {
    return this.active.size > 0
  }

  startTurn(req: StartTurnRequest): string {
    const session = this.store.get(req.sessionId)
    if (!session) throw new Error('Oturum bulunamadı')
    if (!existsSync(req.cwd)) throw new Error(`Çalışma klasörü bulunamadı: ${req.cwd}`)

    const runs: Run[] = []
    const mk = (role: RunRole, model: ModelRef, permission: Permission): Run => ({
      id: randomUUID(),
      role,
      model,
      permission,
      status: 'queued',
      text: '',
      events: []
    })
    if (req.mode === 'single') {
      if (!req.single) throw new Error('Model seçilmedi')
      runs.push(mk('single', req.single, req.codingPermission))
    } else if (req.mode === 'pipeline') {
      if (!req.analysis || !req.coding) throw new Error('Analiz ve kodlama modelleri seçilmeli')
      runs.push(mk('analysis', req.analysis, 'read'), mk('coding', req.coding, req.codingPermission))
    } else {
      const models = req.parallel ?? []
      if (models.length === 0) throw new Error('Paralel mod için en az bir model seçilmeli')
      // Aynı klasörde eşzamanlı yazma çakışmalarını önlemek için paralel çalıştırmalar salt okunurdur.
      for (const m of models) runs.push(mk('parallel', m, 'read'))
    }

    const turn: Turn = {
      id: randomUUID(),
      prompt: req.prompt,
      mode: req.mode,
      cwd: req.cwd,
      createdAt: Date.now(),
      status: 'running',
      runs
    }
    session.turns.push(turn)
    session.cwd = req.cwd
    if (session.turns.length === 1 && session.title === 'Yeni oturum') {
      const t = req.prompt.replace(/\s+/g, ' ').trim()
      session.title = t.length > 60 ? t.slice(0, 57) + '…' : t || 'Yeni oturum'
    }
    this.touch(session, true)

    const active: ActiveTurn = { handles: new Set(), cancelled: false }
    this.active.set(turn.id, active)
    void this.execute(session, turn, active)
      .catch((e) => {
        turn.status = 'error'
        for (const r of turn.runs) {
          if (r.status === 'queued' || r.status === 'running') {
            r.status = 'error'
            r.error = String(e?.message ?? e)
          }
        }
      })
      .finally(() => {
        this.active.delete(turn.id)
        this.touch(session, true)
      })
    return turn.id
  }

  cancelTurn(sessionId: string, turnId: string): void {
    const a = this.active.get(turnId)
    if (!a) return
    a.cancelled = true
    for (const h of a.handles) h.cancel()
    a.approve?.(false)
    void sessionId
  }

  continuePipeline(_sessionId: string, turnId: string, approved: boolean): void {
    this.active.get(turnId)?.approve?.(approved)
  }

  cancelAll(): void {
    for (const [, a] of this.active) {
      a.cancelled = true
      for (const h of a.handles) h.cancel()
      a.approve?.(false)
    }
  }

  private async execute(session: Session, turn: Turn, active: ActiveTurn): Promise<void> {
    if (turn.mode === 'pipeline') {
      const [analysis, coding] = turn.runs
      await this.executeRun(session, turn, analysis, `${ANALYSIS_PROMPT}\n\n## İstek\n${turn.prompt}`, active)

      let proceed = analysis.status === 'done' && !active.cancelled
      if (proceed && this.store.getSettings().pipelineApproval) {
        turn.status = 'awaiting-approval'
        this.touch(session, true)
        proceed = await new Promise<boolean>((resolve) => (active.approve = resolve))
        active.approve = undefined
        turn.status = 'running'
        // Onay bandının arayüzden kalkması için durum değişikliğini hemen bildir.
        this.touch(session, true)
      }
      if (proceed && !active.cancelled) {
        const prompt = `${CODING_PROMPT}\n\n## Kullanıcı isteği\n${turn.prompt}\n\n## Analiz planı (${labelOf(analysis.model)})\n${analysis.text}`
        await this.executeRun(session, turn, coding, prompt, active)
      } else {
        coding.status = active.cancelled ? 'cancelled' : 'skipped'
        this.patch(session, turn, coding, { status: coding.status })
      }
    } else {
      await Promise.all(turn.runs.map((r) => this.executeRun(session, turn, r, turn.prompt, active)))
    }

    if (active.cancelled) turn.status = 'cancelled'
    else if (turn.runs.some((r) => r.status === 'error') && !turn.runs.some((r) => r.status === 'done')) turn.status = 'error'
    else turn.status = 'done'
  }

  private async executeRun(session: Session, turn: Turn, run: Run, rolePrompt: string, active: ActiveTurn): Promise<void> {
    if (active.cancelled) {
      run.status = 'cancelled'
      return
    }
    const settings = this.store.getSettings()
    const def = getProvider(run.model.provider)
    const override = settings.providers[def.id]
    const env = await resolveEnv()

    const fail = (message: string): void => {
      run.status = 'error'
      run.error = message
      run.endedAt = Date.now()
      this.patch(session, turn, run, { status: 'error', error: message, endedAt: run.endedAt })
    }

    if (override?.enabled === false) return fail(`${def.name} ayarlardan devre dışı bırakılmış.`)
    const bin = resolveBinary(def, env, override)
    if (!bin) return fail(`${def.name} bulunamadı. Kurulum: ${def.installHint}`)
    if (def.requiresModel && !run.model.model) return fail(`${def.name} için model seçilmelidir.`)

    const resumeKey = `${def.id}:${run.role === 'parallel' ? `parallel:${run.model.model ?? ''}` : run.role}`
    const beforeStatus = run.permission !== 'read' ? await gitStatus(turn.cwd, env) : undefined

    const attempt = async (resumeId: string | undefined): Promise<boolean> => {
      const history = resumeId ? '' : buildHistory(session, turn, settings.historyTurns)
      const spec = def.build({
        model: run.model.model,
        permission: run.permission,
        resumeId,
        prompt: history + rolePrompt
      })
      if (override?.extraArgs?.trim()) spec.args.push(...splitArgs(override.extraArgs))

      run.status = 'running'
      run.startedAt = Date.now()
      run.error = undefined
      this.patch(session, turn, run, { status: 'running', startedAt: run.startedAt, error: undefined })

      const handle = runCli({
        bin,
        spec,
        cwd: turn.cwd,
        env,
        parser: createParser(def.parser),
        timeoutMs: Math.max(1, settings.timeoutMinutes) * 60_000,
        onEvents: (events) => this.applyEvents(session, turn, run, resumeKey, events)
      })
      active.handles.add(handle)
      const outcome = await handle.done
      active.handles.delete(handle)
      this.flushDelta(session, turn, run)

      // Saklanan CLI oturumu artık yoksa (silinmiş/taşınmış) bir kez geçmişle yeniden dene.
      if (outcome.status === 'error' && resumeId && !run.text) {
        delete session.resume[resumeKey]
        return false
      }
      run.status = outcome.status
      run.error = outcome.error
      run.stderr = outcome.stderr?.trim() ? outcome.stderr.slice(-8000) : undefined
      return true
    }

    const resumeId = def.supportsResume ? session.resume[resumeKey] : undefined
    const finished = await attempt(resumeId)
    if (!finished) await attempt(undefined)

    run.endedAt = Date.now()
    if (beforeStatus && run.status !== 'cancelled') {
      const after = await gitStatus(turn.cwd, env)
      if (after) {
        const before = new Set(beforeStatus.map((f) => `${f.status} ${f.path}`))
        run.changedFiles = after.filter((f) => !before.has(`${f.status} ${f.path}`))
      }
    }
    this.patch(session, turn, run, {
      status: run.status,
      error: run.error,
      stderr: run.stderr,
      endedAt: run.endedAt,
      changedFiles: run.changedFiles,
      usage: run.usage
    })
  }

  private applyEvents(session: Session, turn: Turn, run: Run, resumeKey: string, events: ParsedEvent[]): void {
    const p = this.pendingFor(run.id)
    for (const e of events) {
      switch (e.type) {
        case 'text':
          run.text += e.text
          p.text += e.text
          break
        case 'event': {
          const ev = { ...e.event, at: Date.now() }
          if (run.events.length < MAX_EVENTS) {
            run.events.push(ev)
            p.events.push(ev)
          }
          break
        }
        case 'resume':
          session.resume[resumeKey] = e.id
          break
        case 'usage':
          run.usage = { ...run.usage, ...e.usage }
          this.patch(session, turn, run, { usage: run.usage })
          break
        case 'error':
          run.error = e.message
          break
      }
    }
    if (!p.timer) p.timer = setTimeout(() => this.flushDelta(session, turn, run), 60)
  }

  private pendingFor(runId: string): PendingDelta {
    let p = this.pending.get(runId)
    if (!p) {
      p = { text: '', events: [] }
      this.pending.set(runId, p)
    }
    return p
  }

  private flushDelta(session: Session, turn: Turn, run: Run): void {
    const p = this.pending.get(run.id)
    if (!p) return
    if (p.timer) clearTimeout(p.timer)
    this.pending.delete(run.id)
    if (!p.text && !p.events.length) return
    this.events.delta({
      sessionId: session.id,
      turnId: turn.id,
      runId: run.id,
      appendText: p.text || undefined,
      events: p.events.length ? p.events : undefined
    })
    this.store.save(session)
  }

  private patch(session: Session, turn: Turn, run: Run, patch: RunDelta['patch']): void {
    this.flushDelta(session, turn, run)
    this.events.delta({ sessionId: session.id, turnId: turn.id, runId: run.id, patch })
    this.touch(session, false)
  }

  private touch(session: Session, structural: boolean): void {
    session.updatedAt = Date.now()
    this.store.save(session, structural)
    if (structural) {
      this.events.session(session)
      this.events.list()
    }
  }
}

function labelOf(m: ModelRef): string {
  return m.model ? `${m.provider} / ${m.model}` : m.provider
}

/** Resume desteklemeyen (veya ilk kez katılan) CLI'lar için önceki turlardan bağlam metni üretir. */
export function buildHistory(session: Session, current: Turn, maxTurns: number): string {
  if (maxTurns <= 0) return ''
  const prev = session.turns.filter((t) => t.id !== current.id && t.status !== 'cancelled').slice(-maxTurns)
  if (!prev.length) return ''
  const parts = prev.map((t) => {
    const answer = [...t.runs].reverse().find((r) => r.status === 'done' && r.text)
    const text = answer ? answer.text : '(yanıt yok)'
    const clipped = text.length > HISTORY_CHARS ? text.slice(0, HISTORY_CHARS) + '\n…(kısaltıldı)' : text
    return `### Kullanıcı\n${t.prompt}\n\n### Asistan${answer ? ` (${labelOf(answer.model)})` : ''}\n${clipped}`
  })
  return `# Önceki konuşma (bağlam için)\n\n${parts.join('\n\n')}\n\n# Yeni istek\n\n`
}

/** Argüman dizesini shell kurallarına benzer şekilde böler (kelime içindeki tırnaklar dahil). */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let inToken = false
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      inToken = true
    } else if (/\s/.test(ch)) {
      if (inToken) out.push(cur)
      cur = ''
      inToken = false
    } else {
      cur += ch
      inToken = true
    }
  }
  if (inToken) out.push(cur)
  return out
}

async function gitStatus(cwd: string, env: NodeJS.ProcessEnv): Promise<ChangedFile[] | undefined> {
  const r = await execCapture('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, env, timeoutMs: 10000 })
  if (r.code !== 0) return undefined
  return r.stdout
    .split(/\r?\n/)
    .filter((l) => l.length > 3)
    .slice(0, 300)
    .map((l) => ({ status: l.slice(0, 2).trim() || '?', path: l.slice(3) }))
}
