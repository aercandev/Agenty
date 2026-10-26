import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderStatus, SearchHit, SessionSummary } from '@shared/types'
import { api, copyText, cx, isReady, PROVIDER_COLORS, relativeGroup, shortPath } from '../util'
import { Icon, Spinner } from './Icon'

export type SideView = 'sessions' | 'search' | 'providers'

interface SessionsProps {
  sessions: SessionSummary[]
  currentId?: string
  onOpen(id: string): void
  onNew(): void
  onRename(id: string, title: string): void
  onPin(id: string, pinned: boolean): void
  onDelete(id: string): void
  onExport(id: string): void
}

interface MenuState {
  id: string
  x: number
  y: number
}

export function SessionsPanel({ sessions, currentId, onOpen, onNew, onRename, onPin, onDelete, onExport }: SessionsProps) {
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const groups = useMemo(() => {
    const f = filter.toLocaleLowerCase('tr')
    const list = sessions.filter((s) => !f || s.title.toLocaleLowerCase('tr').includes(f) || s.preview.toLocaleLowerCase('tr').includes(f))
    const out: { name: string; items: SessionSummary[] }[] = []
    for (const s of list) {
      const name = s.pinned ? 'Sabitlenenler' : relativeGroup(s.updatedAt)
      let g = out.find((x) => x.name === name)
      if (!g) out.push((g = { name, items: [] }))
      g.items.push(s)
    }
    return out
  }, [sessions, filter])

  const menuSession = menu ? sessions.find((s) => s.id === menu.id) : undefined

  return (
    <div className="panel">
      <div className="panel-head">
        <span>Oturumlar</span>
        <div className="spacer" />
        <button className="icon-btn" title="Yeni oturum (Ctrl+N)" onClick={onNew}>
          <Icon name="plus" size={16} />
        </button>
      </div>
      <div className="panel-pad">
        <button className="btn primary block" onClick={onNew}>
          <Icon name="plus" size={14} /> Yeni oturum
        </button>
        <div className="input-icon">
          <Icon name="search" size={13} />
          <input placeholder="Oturumlarda filtrele" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>
      <div className="panel-scroll">
        {groups.length === 0 && <div className="empty-note">{filter ? 'Eşleşen oturum yok' : 'Henüz oturum yok'}</div>}
        {groups.map((g) => (
          <div key={g.name} className="group">
            <div className="group-title">{g.name}</div>
            {g.items.map((s) => (
              <div
                key={s.id}
                className={cx('session-item', s.id === currentId && 'active')}
                onClick={() => onOpen(s.id)}
                onDoubleClick={() => setEditing(s.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ id: s.id, x: e.clientX, y: e.clientY })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'F2') setEditing(s.id)
                  if (e.key === 'Delete') setConfirmDelete(s.id)
                }}
                tabIndex={0}
              >
                {s.running ? <Spinner size={12} /> : <Icon name={s.pinned ? 'pin' : 'chat'} size={14} />}
                {editing === s.id ? (
                  <RenameInput
                    value={s.title}
                    onDone={(v) => {
                      setEditing(null)
                      if (v && v !== s.title) onRename(s.id, v)
                    }}
                  />
                ) : (
                  <div className="session-text">
                    <div className="session-title">{s.title}</div>
                    {s.cwd && <div className="session-sub">{shortPath(s.cwd)}</div>}
                  </div>
                )}
                {confirmDelete === s.id ? (
                  <span className="confirm" onClick={(e) => e.stopPropagation()}>
                    <button className="btn danger tiny" onClick={() => (onDelete(s.id), setConfirmDelete(null))}>
                      Sil
                    </button>
                    <button className="btn tiny" onClick={() => setConfirmDelete(null)}>
                      Vazgeç
                    </button>
                  </span>
                ) : (
                  <button
                    className="icon-btn hover-only"
                    title="Diğer"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenu({ id: s.id, x: e.clientX, y: e.clientY })
                    }}
                  >
                    <Icon name="more" size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      {menu && menuSession && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <button onClick={() => setEditing(menu.id)}>
            <Icon name="edit" size={13} /> Yeniden adlandır <kbd>F2</kbd>
          </button>
          <button onClick={() => onPin(menu.id, !menuSession.pinned)}>
            <Icon name="pin" size={13} /> {menuSession.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'}
          </button>
          <button onClick={() => onExport(menu.id)}>
            <Icon name="download" size={13} /> Markdown olarak dışa aktar
          </button>
          {menuSession.cwd && (
            <button onClick={() => void api.openPath(menuSession.cwd!)}>
              <Icon name="folder" size={13} /> Klasörü aç
            </button>
          )}
          <div className="sep" />
          <button className="danger" onClick={() => setConfirmDelete(menu.id)}>
            <Icon name="trash" size={13} /> Sil <kbd>Del</kbd>
          </button>
        </div>
      )}
    </div>
  )
}

function RenameInput({ value, onDone }: { value: string; onDone(v: string): void }) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      className="rename"
      value={v}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(v.trim())
        if (e.key === 'Escape') onDone(value)
      }}
    />
  )
}

export function SearchPanel({ onOpen, autoFocus }: { onOpen(id: string): void; autoFocus?: boolean }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!q.trim()) return setHits([])
    setBusy(true)
    const t = setTimeout(() => {
      void api.searchSessions(q).then((h) => {
        setHits(h)
        setBusy(false)
      })
    }, 180)
    return () => clearTimeout(t)
  }, [q])

  const highlight = (text: string) => {
    const i = text.toLocaleLowerCase('tr').indexOf(q.trim().toLocaleLowerCase('tr'))
    if (i < 0) return text
    const n = q.trim().length
    return (
      <>
        {text.slice(0, i)}
        <mark>{text.slice(i, i + n)}</mark>
        {text.slice(i + n)}
      </>
    )
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span>Ara</span>
      </div>
      <div className="panel-pad">
        <div className="input-icon">
          <Icon name="search" size={13} />
          <input autoFocus={autoFocus} placeholder="Tüm oturumlarda ara (başlık, istem, yanıt)" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {q.trim() && <div className="muted small">{busy ? 'Aranıyor…' : `${hits.length} sonuç`}</div>}
      </div>
      <div className="panel-scroll">
        {hits.map((h) => (
          <button key={h.sessionId} className="search-hit" onClick={() => onOpen(h.sessionId)}>
            <div className="session-title">{highlight(h.title)}</div>
            <div className="snippet">{highlight(h.snippet)}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

export function ProvidersPanel({
  providers,
  scanning,
  onRescan
}: {
  providers: ProviderStatus[]
  scanning: boolean
  onRescan(): void
}) {
  const ready = providers.filter(isReady).length
  return (
    <div className="panel">
      <div className="panel-head">
        <span>Yapay zeka CLI'ları</span>
        <div className="spacer" />
        <button className="icon-btn" title="Yeniden tara" onClick={onRescan} disabled={scanning}>
          {scanning ? <Spinner size={13} /> : <Icon name="refresh" size={14} />}
        </button>
      </div>
      <div className="panel-pad muted small">
        {ready}/{providers.length} hazır · Kimlik bilgileri her CLI'ın kendi oturumundan kullanılır, Agenty anahtar saklamaz.
      </div>
      <div className="panel-scroll">
        {providers.map((p) => (
          <ProviderRow key={p.id} p={p} />
        ))}
      </div>
    </div>
  )
}

export function ProviderRow({ p, wide }: { p: ProviderStatus; wide?: boolean }) {
  const state = !p.installed ? 'off' : p.auth === 'missing' ? 'warn' : p.auth === 'unknown' ? 'unknown' : 'ok'
  const statusText = !p.installed ? 'Kurulu değil' : p.auth === 'missing' ? 'Giriş gerekli' : p.auth === 'unknown' ? 'Kurulu (giriş doğrulanamadı)' : 'Hazır'
  const hint = !p.installed ? p.installHint : p.auth === 'missing' ? p.loginHint : null
  return (
    <div className={cx('provider-row', `st-${state}`, wide && 'wide')}>
      <span className="provider-logo" style={{ background: PROVIDER_COLORS[p.id] }}>
        {p.name[0]}
      </span>
      <div className="provider-info">
        <div className="provider-name">
          {p.name} <span className="muted">{p.vendor}</span>
        </div>
        <div className="provider-status">
          <span className={cx('status-dot', state)} /> {statusText}
          {p.version && <span className="muted"> · v{p.version}</span>}
          {p.authDetail && p.installed && <span className="muted"> · {p.authDetail}</span>}
        </div>
        {p.error && p.installed === false && p.path && <div className="muted small">{p.error}</div>}
        {wide && p.path && <div className="muted small mono">{p.path}</div>}
        {wide && p.models.length > 0 && <div className="muted small">{p.models.length} model: {p.models.slice(0, 6).join(', ')}{p.models.length > 6 ? '…' : ''}</div>}
        {hint && (
          <div className="hint">
            <code>{hint}</code>
            {hint.startsWith('http') ? (
              <button className="icon-btn" title="Aç" onClick={() => void api.openExternal(hint)}>
                <Icon name="external" size={12} />
              </button>
            ) : (
              <button className="icon-btn" title="Kopyala" onClick={() => copyText(hint.split('  →')[0])}>
                <Icon name="copy" size={12} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
