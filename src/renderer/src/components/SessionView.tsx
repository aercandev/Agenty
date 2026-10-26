import { useEffect, useRef, useState } from 'react'
import type { ProviderStatus, Run, RunEvent, Session, Turn } from '@shared/types'
import {
  api,
  copyText,
  cx,
  formatDuration,
  formatTokens,
  MODE_LABELS,
  PERMISSION_LABELS,
  PROVIDER_COLORS,
  providerName,
  ROLE_LABELS,
  shortPath
} from '../util'
import { Icon, Spinner, type IconName } from './Icon'
import { Markdown } from './Markdown'

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

const EVENT_ICONS: Record<RunEvent['kind'], IconName> = {
  tool: 'terminal',
  file: 'file',
  thinking: 'brain',
  info: 'info',
  warning: 'alert'
}

function StatusBadge({ run }: { run: Run }) {
  const now = useNow(run.status === 'running')
  const dur = run.startedAt ? formatDuration((run.endedAt ?? now) - run.startedAt) : ''
  switch (run.status) {
    case 'queued':
      return <span className="status muted">Sırada</span>
    case 'running':
      return (
        <span className="status running">
          <Spinner size={11} /> Çalışıyor {dur}
        </span>
      )
    case 'done':
      return (
        <span className="status ok">
          <Icon name="check" size={12} /> {dur}
        </span>
      )
    case 'error':
      return (
        <span className="status err">
          <Icon name="alert" size={12} /> Hata
        </span>
      )
    case 'cancelled':
      return <span className="status muted">İptal edildi</span>
    case 'skipped':
      return <span className="status muted">Atlandı</span>
  }
}

function RunCard({ run, providers, cwd }: { run: Run; providers: ProviderStatus[]; cwd: string }) {
  const [showEvents, setShowEvents] = useState(false)
  const [showStderr, setShowStderr] = useState(false)
  const role = ROLE_LABELS[run.role]
  const lastEvent = run.events[run.events.length - 1]

  return (
    <div className={cx('run', `run-${run.status}`)}>
      <div className="run-head">
        <span className="dot" style={{ background: PROVIDER_COLORS[run.model.provider] }} />
        {role && <span className={cx('role', run.role)}>{role}</span>}
        <span className="run-model">
          {providerName(providers, run.model.provider)}
          <span className="muted"> · {run.model.model ?? 'varsayılan'}</span>
        </span>
        <span className="perm" title={PERMISSION_LABELS[run.permission]}>
          <Icon name={run.permission === 'read' ? 'lock' : run.permission === 'full' ? 'zap' : 'edit'} size={11} />
        </span>
        <div className="spacer" />
        {run.usage && (
          <span
            className="usage"
            title={`Girdi: ${run.usage.inputTokens ?? '–'} · Çıktı: ${run.usage.outputTokens ?? '–'} token`}
          >
            {formatTokens(run.usage.inputTokens)} → {formatTokens(run.usage.outputTokens)}
            {run.usage.costUsd != null && <> · ${run.usage.costUsd.toFixed(3)}</>}
          </span>
        )}
        <StatusBadge run={run} />
        {run.text && (
          <button className="icon-btn" title="Yanıtı kopyala" onClick={() => copyText(run.text)}>
            <Icon name="copy" size={13} />
          </button>
        )}
      </div>

      <div className="run-body">
        {run.text ? (
          <Markdown text={run.text} />
        ) : run.status === 'running' || run.status === 'queued' ? (
          <div className="placeholder">
            <div className="shimmer" />
            <div className="shimmer short" />
          </div>
        ) : null}
        {run.status === 'running' && lastEvent && (
          <div className="live-event">
            <Icon name={EVENT_ICONS[lastEvent.kind]} size={12} />
            <b>{lastEvent.label}</b> <span className="muted">{lastEvent.detail}</span>
          </div>
        )}
        {run.error && (
          <div className="run-error">
            <Icon name="alert" size={14} />
            <div>
              <pre>{run.error}</pre>
              {run.stderr && run.stderr !== run.error && (
                <button className="link" onClick={() => setShowStderr((s) => !s)}>
                  {showStderr ? 'stderr gizle' : 'stderr göster'}
                </button>
              )}
              {showStderr && <pre className="stderr">{run.stderr}</pre>}
            </div>
          </div>
        )}
      </div>

      {(run.events.length > 0 || (run.changedFiles?.length ?? 0) > 0) && (
        <div className="run-foot">
          {run.events.length > 0 && (
            <button className="link" onClick={() => setShowEvents((s) => !s)}>
              <Icon name={showEvents ? 'chevronDown' : 'chevronRight'} size={12} />
              Aktivite ({run.events.length})
            </button>
          )}
          {showEvents && (
            <ul className="events">
              {run.events.map((e, i) => (
                <li key={i} className={`ev-${e.kind}`}>
                  <Icon name={EVENT_ICONS[e.kind]} size={12} />
                  <b>{e.label}</b>
                  {e.detail && <span className="muted">{e.detail}</span>}
                </li>
              ))}
            </ul>
          )}
          {run.changedFiles && run.changedFiles.length > 0 && (
            <div className="changed">
              <div className="changed-title">Değişen dosyalar ({run.changedFiles.length})</div>
              {run.changedFiles.map((f) => (
                <button
                  key={f.path}
                  className="changed-file"
                  title="Dosyayı aç"
                  onClick={() => void api.openPath(`${cwd}/${f.path}`)}
                >
                  <span className={`git-${f.status.replace('?', 'U')[0]}`}>{f.status}</span>
                  {f.path}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TurnView({ session, turn, providers }: { session: Session; turn: Turn; providers: ProviderStatus[] }) {
  return (
    <div className="turn">
      <div className="prompt">
        <div className="avatar">Sen</div>
        <div className="prompt-body">
          <div className="prompt-meta">
            <span className="chip small">{MODE_LABELS[turn.mode]}</span>
            <span className="muted" title={turn.cwd}>
              <Icon name="folder" size={11} /> {shortPath(turn.cwd)}
            </span>
            <span className="muted">{new Date(turn.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="prompt-text">{turn.prompt}</div>
        </div>
      </div>

      {turn.mode === 'parallel' ? (
        <div className="runs-grid" style={{ ['--cols' as string]: Math.min(turn.runs.length, 3) }}>
          {turn.runs.map((r) => (
            <RunCard key={r.id} run={r} providers={providers} cwd={turn.cwd} />
          ))}
        </div>
      ) : (
        <div className="runs-stack">
          {turn.runs.map((r, i) => (
            <div key={r.id}>
              {turn.mode === 'pipeline' && i === 1 && (
                <>
                  {turn.status === 'awaiting-approval' && (
                    <div className="approval">
                      <Icon name="info" size={16} />
                      <span>Analiz tamamlandı. Plan kodlama modeline gönderilsin mi?</span>
                      <div className="spacer" />
                      <button className="btn" onClick={() => void api.continuePipeline(session.id, turn.id, false)}>
                        Atla
                      </button>
                      <button className="btn primary" onClick={() => void api.continuePipeline(session.id, turn.id, true)}>
                        <Icon name="code" size={14} /> Kodlamaya geç
                      </button>
                    </div>
                  )}
                  <div className="handoff">
                    <Icon name="arrowRight" size={12} /> plan kodlama ajanına aktarılır
                  </div>
                </>
              )}
              <RunCard run={r} providers={providers} cwd={turn.cwd} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SessionView({ session, providers }: { session: Session; providers: ProviderStatus[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  // Kullanıcı yukarı kaydırmadıysa akış sırasında en alta yapışık kal.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })
  useEffect(() => {
    stick.current = true
  }, [session.id])

  return (
    <div
      className="messages"
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
    >
      <div className="messages-inner">
        {session.turns.map((t) => (
          <TurnView key={t.id} session={session} turn={t} providers={providers} />
        ))}
      </div>
    </div>
  )
}
