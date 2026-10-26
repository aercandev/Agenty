import type { ProviderId, ProviderOverride, ProviderStatus, Settings } from '@shared/types'
import type { ReactNode } from 'react'
import { api, cx, PROVIDER_COLORS } from '../util'
import { Icon } from './Icon'

interface Props {
  settings: Settings
  providers: ProviderStatus[]
  onChange(patch: Partial<Settings>): void
  onRunWizard(): void
  onRescan(): void
}

/** VS Code ayarlar sayfası düzeninde (başlık, açıklama, kontrol) ayarlar. */
export function SettingsView({ settings, providers, onChange, onRunWizard, onRescan }: Props) {
  const setProvider = (id: ProviderId, patch: Partial<ProviderOverride>) => {
    const cur = settings.providers[id] ?? { enabled: true }
    onChange({ providers: { ...settings.providers, [id]: { ...cur, ...patch } } })
  }

  return (
    <div className="settings">
      <div className="settings-inner">
        <h1>Ayarlar</h1>

        <h2>Genel</h2>
        <Setting title="Tema" desc="Arayüz renk teması.">
          <div className="segmented">
            {(['dark', 'light', 'system'] as const).map((t) => (
              <button key={t} className={cx(settings.theme === t && 'active')} onClick={() => onChange({ theme: t })}>
                {t === 'dark' ? 'Koyu' : t === 'light' ? 'Açık' : 'Sistem'}
              </button>
            ))}
          </div>
        </Setting>
        <Setting title="Yazı boyutu" desc="Mesaj alanındaki yazı boyutu (px).">
          <input
            className="input narrow"
            type="number"
            min={11}
            max={20}
            value={settings.fontSize}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) || 13 })}
          />
        </Setting>
        <Setting title="Varsayılan çalışma klasörü" desc="Yeni oturumların başladığı klasör.">
          <div className="row">
            <input className="input mono grow" value={settings.defaultCwd} onChange={(e) => onChange({ defaultCwd: e.target.value })} />
            <button
              className="btn"
              onClick={() =>
                void api.pickFolder(settings.defaultCwd).then((p) => {
                  if (p) onChange({ defaultCwd: p })
                })
              }
            >
              Seç…
            </button>
          </div>
        </Setting>

        <h2>Çalıştırma</h2>
        <Setting title="Analiz → Kod onayı" desc="Analiz bittiğinde planı kodlama modeline göndermeden önce onay iste.">
          <label className="check">
            <input type="checkbox" checked={settings.pipelineApproval} onChange={(e) => onChange({ pipelineApproval: e.target.checked })} />
            <span>Onay iste</span>
          </label>
        </Setting>
        <Setting title="Zaman aşımı" desc="Bir CLI çalıştırması bu süreyi aşarsa sonlandırılır (dakika).">
          <input
            className="input narrow"
            type="number"
            min={1}
            max={240}
            value={settings.timeoutMinutes}
            onChange={(e) => onChange({ timeoutMinutes: Number(e.target.value) || 30 })}
          />
        </Setting>
        <Setting
          title="Bağlam geçmişi"
          desc="Kendi oturumunu sürdüremeyen CLI'lara (Gemini, Ollama…) bağlam olarak gönderilecek önceki tur sayısı. Claude Code ve Codex kendi oturumlarını devam ettirir."
        >
          <input
            className="input narrow"
            type="number"
            min={0}
            max={30}
            value={settings.historyTurns}
            onChange={(e) => onChange({ historyTurns: Math.max(0, Number(e.target.value)) })}
          />
        </Setting>

        <h2>
          Sağlayıcılar
          <button className="btn small" onClick={onRescan}>
            <Icon name="refresh" size={12} /> Yeniden tara
          </button>
          <button className="btn small" onClick={onRunWizard}>
            Kurulum sihirbazı
          </button>
        </h2>
        {providers.map((p) => {
          const o = settings.providers[p.id] ?? { enabled: true }
          return (
            <div key={p.id} className={cx('setting provider-setting', !p.installed && 'dim')}>
              <div className="setting-title">
                <span className="dot" style={{ background: PROVIDER_COLORS[p.id] }} />
                {p.name}
                <span className="muted small">{p.installed ? `v${p.version}` : 'kurulu değil'}</span>
                <div className="spacer" />
                <label className="check">
                  <input type="checkbox" checked={o.enabled !== false} onChange={(e) => setProvider(p.id, { enabled: e.target.checked })} />
                  <span>Etkin</span>
                </label>
              </div>
              <div className="grid2">
                <label>
                  <small>Çalıştırılabilir dosya yolu (boş = otomatik: {p.path ?? 'bulunamadı'})</small>
                  <input className="input mono" value={o.path ?? ''} placeholder={p.path} onChange={(e) => setProvider(p.id, { path: e.target.value || undefined })} />
                </label>
                <label>
                  <small>Ek argümanlar (her çağrıya eklenir)</small>
                  <input
                    className="input mono"
                    value={o.extraArgs ?? ''}
                    placeholder={p.id === 'claude' ? '--append-system-prompt "Türkçe yanıt ver"' : p.id === 'codex' ? '-c model_reasoning_effort="high"' : ''}
                    onChange={(e) => setProvider(p.id, { extraArgs: e.target.value || undefined })}
                  />
                </label>
              </div>
            </div>
          )
        })}

        <h2>Hakkında</h2>
        <p className="muted">
          Agenty v0.1.0 · Veriler yalnızca bu bilgisayarda saklanır. Model çağrıları doğrudan kurulu CLI'lar üzerinden yapılır.
        </p>
      </div>
    </div>
  )
}

function Setting({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-title">{title}</div>
      <div className="setting-desc">{desc}</div>
      {children}
    </div>
  )
}
