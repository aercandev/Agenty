import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionSummary } from '@shared/types'
import { cx, shortPath } from '../util'
import { Icon } from './Icon'

export interface Command {
  id: string
  label: string
  keys?: string
  run(): void
}

interface Props {
  initial: string
  commands: Command[]
  sessions: SessionSummary[]
  onOpenSession(id: string): void
  onClose(): void
}

/** VS Code tarzı hızlı açma: düz metin → oturumlar, ">" ile başlayan → komutlar. */
export function CommandPalette({ initial, commands, sessions, onOpenSession, onClose }: Props) {
  const [q, setQ] = useState(initial)
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const isCmd = q.startsWith('>')
  const items = useMemo(() => {
    const term = (isCmd ? q.slice(1) : q).trim().toLocaleLowerCase('tr')
    if (isCmd) {
      return commands
        .filter((c) => !term || c.label.toLocaleLowerCase('tr').includes(term))
        .map((c) => ({ key: c.id, label: c.label, sub: c.keys, run: c.run, icon: 'terminal' as const }))
    }
    return sessions
      .filter((s) => !term || s.title.toLocaleLowerCase('tr').includes(term))
      .slice(0, 50)
      .map((s) => ({ key: s.id, label: s.title, sub: shortPath(s.cwd), run: () => onOpenSession(s.id), icon: 'chat' as const }))
  }, [q, isCmd, commands, sessions, onOpenSession])

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const exec = (i: number) => {
    const it = items[i]
    if (!it) return
    onClose()
    it.run()
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          placeholder="Oturum ara veya komut için > yazın"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(items.length - 1, s + 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(0, s - 1))
            }
            if (e.key === 'Enter') exec(sel)
          }}
        />
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <div className="palette-empty">Sonuç yok</div>}
          {items.map((it, i) => (
            <button key={it.key} className={cx('palette-item', i === sel && 'active')} onMouseMove={() => setSel(i)} onClick={() => exec(i)}>
              <Icon name={it.icon} size={14} />
              <span className="grow">{it.label}</span>
              {it.sub && <span className="muted small">{it.sub}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
