import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelRef, ProviderStatus } from '@shared/types'
import { cx, isReady, PROVIDER_COLORS, sameModel } from '../util'
import { Icon } from './Icon'

interface Props {
  value?: ModelRef
  providers: ProviderStatus[]
  onChange(m: ModelRef): void
  label?: string
  icon?: 'brain' | 'code' | 'sparkle' | 'plus'
  /** Yalnızca dosya düzenleyebilen (agentic) CLI'ları göster */
  agenticOnly?: boolean
  placeholder?: string
  compact?: boolean
}

/** VS Code quick-pick benzeri, sağlayıcıya göre gruplanmış model seçici. */
export function ModelPicker({ value, providers, onChange, label, icon, agenticOnly, placeholder, compact }: Props) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [custom, setCustom] = useState<Record<string, string>>({})
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setFilter('')
    setTimeout(() => inputRef.current?.focus(), 0)
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const groups = useMemo(() => {
    const f = filter.toLowerCase()
    return providers
      .filter((p) => p.installed && (!agenticOnly || p.agentic))
      .map((p) => {
        const models = p.id === 'ollama' ? p.models : [undefined, ...p.models]
        return {
          p,
          models: models.filter((m) => !f || p.name.toLowerCase().includes(f) || (m ?? 'varsayılan').toLowerCase().includes(f))
        }
      })
      .filter((g) => g.models.length > 0 || !f)
  }, [providers, filter, agenticOnly])

  const current = value ? providers.find((p) => p.id === value.provider) : undefined
  const pick = (m: ModelRef) => {
    onChange(m)
    setOpen(false)
  }

  return (
    <div className={cx('picker', compact && 'compact')} ref={ref}>
      <button
        className={cx('picker-btn', !value && 'empty', value && !isReady(current) && 'warn')}
        onClick={() => setOpen((o) => !o)}
        title={value && !isReady(current) ? 'Bu sağlayıcı hazır değil' : undefined}
      >
        {icon && <Icon name={icon} size={14} />}
        {label && <span className="picker-label">{label}</span>}
        {value ? (
          <>
            <span className="dot" style={{ background: PROVIDER_COLORS[value.provider] }} />
            <span className="picker-value">
              {current?.name ?? value.provider}
              <span className="muted"> · {value.model ?? 'varsayılan'}</span>
            </span>
          </>
        ) : (
          <span className="picker-value muted">{placeholder ?? 'Model seç'}</span>
        )}
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="picker-pop">
          <input
            ref={inputRef}
            className="picker-filter"
            placeholder="Model veya sağlayıcı ara…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="picker-list">
            {groups.length === 0 && <div className="picker-empty">Kurulu CLI bulunamadı. Sağlayıcıları yeniden tarayın.</div>}
            {groups.map(({ p, models }) => (
              <div key={p.id} className={cx('picker-group', !isReady(p) && 'disabled')}>
                <div className="picker-group-head">
                  <span className="dot" style={{ background: PROVIDER_COLORS[p.id] }} />
                  {p.name}
                  <span className="muted">{p.vendor}</span>
                  {p.auth === 'missing' && <span className="badge warn">giriş yok</span>}
                  {!p.agentic && <span className="badge">yalnızca sohbet</span>}
                </div>
                {models.map((m) => {
                  const ref: ModelRef = { provider: p.id, model: m }
                  return (
                    <button
                      key={m ?? '__default'}
                      className={cx('picker-item', sameModel(ref, value) && 'active')}
                      onClick={() => pick(ref)}
                    >
                      {m ?? <span className="muted">CLI varsayılanı</span>}
                      {sameModel(ref, value) && <Icon name="check" size={13} />}
                    </button>
                  )
                })}
                <input
                  className="picker-custom"
                  placeholder="Özel model adı + Enter"
                  value={custom[p.id] ?? ''}
                  onChange={(e) => setCustom((c) => ({ ...c, [p.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    const v = (custom[p.id] ?? '').trim()
                    if (e.key === 'Enter' && v) pick({ provider: p.id, model: v })
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
