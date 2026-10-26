import { useEffect, useState } from 'react'
import type { ModelRef, ProviderStatus, Settings } from '@shared/types'
import { api, cx, isReady, suggestDefaults } from '../util'
import { Icon, Spinner } from './Icon'
import { ModelPicker } from './ModelPicker'
import { ProviderRow } from './Sidebar'

interface Props {
  settings: Settings
  providers: ProviderStatus[]
  scanning: boolean
  onRescan(): Promise<ProviderStatus[]>
  onFinish(patch: Partial<Settings>): void
  onClose?(): void
}

const STEPS = ['Hoş geldin', 'CLI taraması', 'Modeller', 'Çalışma alanı']

export function SetupWizard({ settings, providers, scanning, onRescan, onFinish, onClose }: Props) {
  const [step, setStep] = useState(0)
  const [analysis, setAnalysis] = useState<ModelRef | undefined>(settings.analysisModel)
  const [coding, setCoding] = useState<ModelRef | undefined>(settings.codingModel)
  const [single, setSingle] = useState<ModelRef | undefined>(settings.singleModel)
  const [cwd, setCwd] = useState(settings.defaultCwd)
  const [theme, setTheme] = useState(settings.theme)
  const [approval, setApproval] = useState(settings.pipelineApproval)

  // Tarama adımına gelindiğinde taze tarama yap ve boş seçimleri öneriyle doldur.
  useEffect(() => {
    if (step !== 1) return
    void onRescan().then((p) => {
      const d = suggestDefaults(p)
      setAnalysis((a) => a ?? d.analysis)
      setCoding((c) => c ?? d.coding)
      setSingle((s) => s ?? d.single)
    })
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = providers.filter(isReady)
  const finish = () =>
    onFinish({
      setupComplete: true,
      analysisModel: analysis,
      codingModel: coding,
      singleModel: single,
      parallelModels: settings.parallelModels.length
        ? settings.parallelModels
        : [analysis, coding].filter((m): m is ModelRef => !!m).filter((m, i, a) => a.findIndex((x) => x.provider === m.provider && x.model === m.model) === i),
      defaultCwd: cwd,
      theme,
      pipelineApproval: approval
    })

  return (
    <div className="wizard-backdrop">
      <div className="wizard">
        <div className="wizard-side">
          <div className="wizard-brand">
            <span className="logo">A</span> Agenty
          </div>
          <ol>
            {STEPS.map((s, i) => (
              <li key={s} className={cx(i === step && 'active', i < step && 'done')}>
                <span className="step-num">{i < step ? <Icon name="check" size={12} /> : i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          {onClose && (
            <button className="link" onClick={onClose}>
              Sihirbazı kapat
            </button>
          )}
        </div>

        <div className="wizard-main">
          {step === 0 && (
            <div className="wizard-page">
              <h1>Agenty'ye hoş geldin</h1>
              <p className="lead">
                Agenty, bilgisayarında <b>zaten kurulu ve giriş yapılmış</b> yapay zeka CLI'larını (Claude Code, Codex, Gemini, Ollama…) tek
                pencereden ve aynı anda kullanmanı sağlar.
              </p>
              <div className="feature-grid">
                <Feature icon="shield" title="API anahtarı yok" text="Her CLI kendi oturumunu kullanır. Agenty kimlik bilgisi saklamaz veya görmez." />
                <Feature icon="brain" title="Analiz → Kod" text="Bir model planı çıkarır, diğeri uygular. İstersen arada onay verirsin." />
                <Feature icon="columns" title="Paralel karşılaştırma" text="Aynı soruyu birden fazla modele aynı anda sor, yanıtları yan yana gör." />
                <Feature icon="history" title="Kalıcı oturumlar" text="Konuşmalar yerelde saklanır, aranabilir ve Markdown olarak dışa aktarılabilir." />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-page">
              <h1>Bilgisayar taranıyor</h1>
              <p className="lead">
                PATH üzerinde bilinen CLI'lar aranıyor, sürümleri ve giriş durumları kontrol ediliyor.
                {scanning ? '' : ` ${ready.length} CLI kullanıma hazır.`}
              </p>
              <div className="wizard-providers">
                {scanning && providers.length === 0 ? (
                  <div className="center muted">
                    <Spinner /> Taranıyor…
                  </div>
                ) : (
                  [...providers]
                    .sort((a, b) => Number(isReady(b)) - Number(isReady(a)) || Number(b.installed) - Number(a.installed))
                    .map((p) => <ProviderRow key={p.id} p={p} wide />)
                )}
              </div>
              <div className="row">
                <button className="btn" onClick={() => void onRescan()} disabled={scanning}>
                  {scanning ? <Spinner size={12} /> : <Icon name="refresh" size={13} />} Yeniden tara
                </button>
                <span className="muted small">Eksik bir CLI'ı kurduktan / giriş yaptıktan sonra yeniden tarayın.</span>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-page">
              <h1>Varsayılan modeller</h1>
              <p className="lead">Bunları istediğin zaman istem alanından değiştirebilirsin.</p>
              <div className="form">
                <label>
                  <span>
                    <Icon name="brain" size={14} /> Analiz modeli
                  </span>
                  <small>İsteği inceler, dosyaları okur ve uygulama planı çıkarır (salt okunur çalışır).</small>
                  <ModelPicker value={analysis} providers={providers} onChange={setAnalysis} />
                </label>
                <label>
                  <span>
                    <Icon name="code" size={14} /> Kodlama modeli
                  </span>
                  <small>Analiz planını alır ve çalışma klasöründe uygular.</small>
                  <ModelPicker value={coding} providers={providers} onChange={setCoding} agenticOnly />
                </label>
                <label>
                  <span>
                    <Icon name="sparkle" size={14} /> Tekli mod modeli
                  </span>
                  <small>Hızlı sorular ve tek modelle yapılacak işler için.</small>
                  <ModelPicker value={single} providers={providers} onChange={setSingle} />
                </label>
                <label className="check">
                  <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
                  <span>Analizden sonra kodlamaya geçmeden önce onayımı iste</span>
                </label>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="wizard-page">
              <h1>Çalışma alanı</h1>
              <p className="lead">Yeni oturumlar bu klasörde başlar. CLI'lar dosyaları bu klasöre göre okur ve düzenler.</p>
              <div className="form">
                <label>
                  <span>
                    <Icon name="folder" size={14} /> Varsayılan klasör
                  </span>
                  <div className="row">
                    <input className="input mono grow" value={cwd} onChange={(e) => setCwd(e.target.value)} />
                    <button
                      className="btn"
                      onClick={() =>
                        void api.pickFolder(cwd).then((p) => {
                          if (p) setCwd(p)
                        })
                      }
                    >
                      Seç…
                    </button>
                  </div>
                </label>
                <label>
                  <span>Tema</span>
                  <div className="segmented">
                    {(['dark', 'light', 'system'] as const).map((t) => (
                      <button key={t} className={cx(theme === t && 'active')} onClick={() => setTheme(t)}>
                        {t === 'dark' ? 'Koyu' : t === 'light' ? 'Açık' : 'Sistem'}
                      </button>
                    ))}
                  </div>
                </label>
              </div>
            </div>
          )}

          <div className="wizard-nav">
            {step > 0 && (
              <button className="btn" onClick={() => setStep(step - 1)}>
                Geri
              </button>
            )}
            <div className="spacer" />
            {step < STEPS.length - 1 ? (
              <button className="btn primary" onClick={() => setStep(step + 1)} disabled={step === 1 && scanning}>
                Devam <Icon name="arrowRight" size={13} />
              </button>
            ) : (
              <button className="btn primary" onClick={finish}>
                <Icon name="check" size={13} /> Başla
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Feature({ icon, title, text }: { icon: 'shield' | 'brain' | 'columns' | 'history'; title: string; text: string }) {
  return (
    <div className="feature">
      <Icon name={icon} size={20} />
      <b>{title}</b>
      <span>{text}</span>
    </div>
  )
}
