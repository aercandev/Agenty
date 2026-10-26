// Ayarlar ve oturumlar için JSON tabanlı kalıcı depolama (userData/agenty altında).
// Native modül gerektirmez; her oturum ayrı dosyadır ve atomik (tmp + rename) yazılır.

import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SearchHit, Session, SessionSummary, Settings } from '../shared/types.ts'

export const DEFAULT_SETTINGS: Settings = {
  setupComplete: false,
  theme: 'dark',
  defaultCwd: homedir(),
  mode: 'pipeline',
  parallelModels: [],
  codingPermission: 'edit',
  pipelineApproval: true,
  timeoutMinutes: 30,
  historyTurns: 6,
  fontSize: 13,
  sidebarWidth: 280,
  providers: {}
}

function writeAtomic(path: string, data: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, path)
}

export class Store {
  private settingsPath: string
  private sessionsDir: string
  private sessions = new Map<string, Session>()
  private settings: Settings
  private pendingWrites = new Map<string, NodeJS.Timeout>()

  constructor(root: string) {
    this.settingsPath = join(root, 'settings.json')
    this.sessionsDir = join(root, 'sessions')
    mkdirSync(this.sessionsDir, { recursive: true })
    this.settings = { ...DEFAULT_SETTINGS }
    try {
      this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(this.settingsPath, 'utf8')) }
    } catch {
      // ilk çalıştırma
    }
    for (const f of readdirSync(this.sessionsDir)) {
      if (!f.endsWith('.json')) continue
      try {
        const s = JSON.parse(readFileSync(join(this.sessionsDir, f), 'utf8')) as Session
        // Uygulama kapanırken yarım kalan çalıştırmaları iptal edilmiş say.
        for (const t of s.turns) {
          if (t.status === 'running' || t.status === 'awaiting-approval') t.status = 'cancelled'
          for (const r of t.runs) if (r.status === 'running' || r.status === 'queued') r.status = 'cancelled'
        }
        s.resume ??= {}
        this.sessions.set(s.id, s)
      } catch {
        // bozuk dosyayı atla
      }
    }
  }

  getSettings(): Settings {
    return this.settings
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch }
    writeAtomic(this.settingsPath, this.settings)
    return this.settings
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()]
      .map((s) => summarize(s))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  create(cwd?: string): Session {
    const now = Date.now()
    const s: Session = { id: randomUUID(), title: 'Yeni oturum', createdAt: now, updatedAt: now, cwd, turns: [], resume: {} }
    this.sessions.set(s.id, s)
    this.save(s, true)
    return s
  }

  /** immediate=false iken yazmalar 1 sn içinde birleştirilir (akış sırasında disk yükünü azaltır). */
  save(s: Session, immediate = false): void {
    const path = join(this.sessionsDir, `${s.id}.json`)
    const existing = this.pendingWrites.get(s.id)
    if (existing) clearTimeout(existing)
    if (immediate) {
      this.pendingWrites.delete(s.id)
      writeAtomic(path, s)
      return
    }
    this.pendingWrites.set(
      s.id,
      setTimeout(() => {
        this.pendingWrites.delete(s.id)
        if (this.sessions.has(s.id)) writeAtomic(path, s)
      }, 1000)
    )
  }

  delete(id: string): void {
    const t = this.pendingWrites.get(id)
    if (t) clearTimeout(t)
    this.pendingWrites.delete(id)
    this.sessions.delete(id)
    rmSync(join(this.sessionsDir, `${id}.json`), { force: true })
  }

  flush(): void {
    for (const [id, t] of this.pendingWrites) {
      clearTimeout(t)
      const s = this.sessions.get(id)
      if (s) writeAtomic(join(this.sessionsDir, `${id}.json`), s)
    }
    this.pendingWrites.clear()
  }

  search(query: string): SearchHit[] {
    const q = query.trim().toLocaleLowerCase('tr')
    if (!q) return []
    const hits: SearchHit[] = []
    for (const s of this.sessions.values()) {
      const haystacks = [s.title, ...s.turns.flatMap((t) => [t.prompt, ...t.runs.map((r) => r.text)])]
      for (const h of haystacks) {
        const idx = h.toLocaleLowerCase('tr').indexOf(q)
        if (idx >= 0) {
          const start = Math.max(0, idx - 40)
          const snippet = (start > 0 ? '…' : '') + h.slice(start, idx + q.length + 80).replace(/\s+/g, ' ')
          hits.push({ sessionId: s.id, title: s.title, snippet, updatedAt: s.updatedAt })
          break
        }
      }
    }
    return hits.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100)
  }
}

export function summarize(s: Session): SessionSummary {
  const last = s.turns[s.turns.length - 1]
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    pinned: s.pinned,
    cwd: s.cwd,
    turnCount: s.turns.length,
    running: s.turns.some((t) => t.status === 'running'),
    preview: last ? last.prompt.slice(0, 120) : ''
  }
}

export function sessionToMarkdown(s: Session): string {
  const lines = [`# ${s.title}`, '', `_Agenty · ${new Date(s.createdAt).toLocaleString('tr-TR')}_`, '']
  for (const t of s.turns) {
    lines.push('---', '', `## 🧑 İstem (${t.mode})`, '', t.prompt, '')
    for (const r of t.runs) {
      const model = `${r.model.provider}${r.model.model ? ' / ' + r.model.model : ''}`
      lines.push(`### 🤖 ${r.role} — ${model} (${r.status})`, '', r.text || r.error || '_(çıktı yok)_', '')
      if (r.changedFiles?.length) {
        lines.push('**Değişen dosyalar:**', ...r.changedFiles.map((f) => `- \`${f.status}\` ${f.path}`), '')
      }
    }
  }
  return lines.join('\n')
}
