import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { ModelRef, Permission, ProviderStatus, RunMode, Settings } from '@shared/types'
import { cx, MODE_HINTS, MODE_LABELS, PERMISSION_HINTS, PERMISSION_LABELS, PROVIDER_COLORS, sameModel, shortPath } from '../util'
import { Icon } from './Icon'
import { ModelPicker } from './ModelPicker'

interface Props {
  settings: Settings
  providers: ProviderStatus[]
  cwd: string
  running: boolean
  onCwdChange(): void
  onSettings(patch: Partial<Settings>): void
  onSend(prompt: string): void
  onStop(): void
}

export interface ComposerHandle {
  focus(): void
}

const MODES: RunMode[] = ['single', 'pipeline', 'parallel']
const PERMISSIONS: Permission[] = ['read', 'edit', 'full']

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { settings, providers, cwd, running, onCwdChange, onSettings, onSend, onStop },
  handle
) {
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(handle, () => ({ focus: () => taRef.current?.focus() }))

  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 320) + 'px'
  }, [text])

  const mode = settings.mode
  const missing =
    (mode === 'single' && !settings.singleModel) ||
    (mode === 'pipeline' && (!settings.analysisModel || !settings.codingModel)) ||
    (mode === 'parallel' && settings.parallelModels.length === 0)
  const canSend = !!text.trim() && !missing && !running

  const send = () => {
    if (!canSend) return
    onSend(text.trim())
    setText('')
  }

  const addParallel = (m: ModelRef) => {
    if (settings.parallelModels.some((x) => sameModel(x, m))) return
    onSettings({ parallelModels: [...settings.parallelModels, m] })
  }

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={taRef}
          value={text}
          rows={2}
          placeholder={
            mode === 'pipeline'
              ? 'Ne yapılmasını istiyorsun? Analiz modeli plan çıkaracak, kodlama modeli uygulayacak…'
              : mode === 'parallel'
                ? 'Tüm seçili modellere aynı anda sorulacak soru…'
                : 'Bir soru sor veya görev ver…'
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="composer-bar">
          <div className="segmented" role="tablist">
            {MODES.map((m) => (
              <button
                key={m}
                className={cx(mode === m && 'active')}
                title={MODE_HINTS[m]}
                onClick={() => onSettings({ mode: m })}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>

          {mode === 'single' && (
            <ModelPicker
              icon="sparkle"
              value={settings.singleModel}
              providers={providers}
              onChange={(m) => onSettings({ singleModel: m })}
            />
          )}
          {mode === 'pipeline' && (
            <>
              <ModelPicker
                icon="brain"
                label="Analiz"
                value={settings.analysisModel}
                providers={providers}
                onChange={(m) => onSettings({ analysisModel: m })}
              />
              <Icon name="arrowRight" size={14} className="muted" />
              <ModelPicker
                icon="code"
                label="Kodlama"
                agenticOnly
                value={settings.codingModel}
                providers={providers}
                onChange={(m) => onSettings({ codingModel: m })}
              />
            </>
          )}
          {mode === 'parallel' && (
            <div className="chips">
              {settings.parallelModels.map((m, i) => (
                <span key={i} className="chip">
                  <span className="dot" style={{ background: PROVIDER_COLORS[m.provider] }} />
                  {providers.find((p) => p.id === m.provider)?.name ?? m.provider}
                  <span className="muted">· {m.model ?? 'varsayılan'}</span>
                  <button
                    title="Kaldır"
                    onClick={() => onSettings({ parallelModels: settings.parallelModels.filter((_, j) => j !== i) })}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </span>
              ))}
              <ModelPicker icon="plus" compact providers={providers} onChange={addParallel} placeholder="Model ekle" />
            </div>
          )}

          <div className="spacer" />

          {mode !== 'parallel' && (
            <select
              className={cx('select', settings.codingPermission === 'full' && 'danger')}
              value={settings.codingPermission}
              title={PERMISSION_HINTS[settings.codingPermission]}
              onChange={(e) => onSettings({ codingPermission: e.target.value as Permission })}
            >
              {PERMISSIONS.map((p) => (
                <option key={p} value={p}>
                  {PERMISSION_LABELS[p]}
                </option>
              ))}
            </select>
          )}
          <button className="cwd-chip" onClick={onCwdChange} title={cwd}>
            <Icon name="folder" size={13} />
            {shortPath(cwd)}
          </button>
          {running ? (
            <button className="send-btn stop" onClick={onStop} title="Durdur">
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button className="send-btn" disabled={!canSend} onClick={send} title={missing ? 'Önce model seçin' : 'Gönder (Enter)'}>
              <Icon name="send" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
