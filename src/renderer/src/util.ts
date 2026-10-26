import type { ModelRef, Permission, ProviderId, ProviderStatus, RunMode, RunRole } from '@shared/types'

export const api = window.agenty

export const PROVIDER_COLORS: Record<ProviderId, string> = {
  claude: '#d97757',
  codex: '#10a37f',
  gemini: '#4285f4',
  qwen: '#7c6cf0',
  cursor: '#a0a0a0',
  copilot: '#8957e5',
  opencode: '#f5a742',
  ollama: '#9aa0a6'
}

export const MODE_LABELS: Record<RunMode, string> = {
  single: 'Tekli',
  pipeline: 'Analiz → Kod',
  parallel: 'Paralel'
}

export const MODE_HINTS: Record<RunMode, string> = {
  single: 'Tek bir model istemi yanıtlar ve seçilen yetkiyle çalışır',
  pipeline: 'Analiz modeli plan çıkarır, kodlama modeli planı uygular',
  parallel: 'Aynı istem birden fazla modele salt okunur olarak aynı anda gönderilir'
}

export const ROLE_LABELS: Record<RunRole, string> = {
  analysis: 'Analiz',
  coding: 'Kodlama',
  single: '',
  parallel: ''
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  read: 'Salt okunur',
  edit: 'Dosya düzenleme',
  full: 'Tam yetki'
}

export const PERMISSION_HINTS: Record<Permission, string> = {
  read: 'Model dosyaları okuyabilir ama değiştiremez',
  edit: 'Model çalışma klasöründeki dosyaları düzenleyebilir',
  full: 'Onay sormadan komut çalıştırır ve dosya düzenler — dikkatli kullanın'
}

export function providerName(providers: ProviderStatus[], id: ProviderId): string {
  return providers.find((p) => p.id === id)?.name ?? id
}

export function modelLabel(providers: ProviderStatus[], m?: ModelRef): string {
  if (!m) return 'Model seç'
  return `${providerName(providers, m.provider)} · ${m.model ?? 'varsayılan'}`
}

export function sameModel(a?: ModelRef, b?: ModelRef): boolean {
  return !!a && !!b && a.provider === b.provider && (a.model ?? '') === (b.model ?? '')
}

export function isReady(p?: ProviderStatus): boolean {
  return !!p && p.installed && p.auth !== 'missing'
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} sn`
  const m = Math.floor(s / 60)
  return `${m} dk ${s % 60} sn`
}

export function formatTokens(n?: number): string {
  if (n == null) return '–'
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)
}

export function relativeGroup(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 86400000
  if (ts >= startOfToday) return 'Bugün'
  if (ts >= startOfToday - day) return 'Dün'
  if (ts >= startOfToday - 7 * day) return 'Son 7 gün'
  if (ts >= startOfToday - 30 * day) return 'Son 30 gün'
  return d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })
}

export function shortPath(p?: string): string {
  if (!p) return ''
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p
}

export function copyText(text: string): void {
  void navigator.clipboard.writeText(text)
}

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ')
}

/** Kurulumdan sonra makul varsayılan modeller önerir. */
export function suggestDefaults(providers: ProviderStatus[]): { analysis?: ModelRef; coding?: ModelRef; single?: ModelRef } {
  const ready = providers.filter(isReady)
  const has = (id: ProviderId) => ready.find((p) => p.id === id)
  const first = (id: ProviderId): ModelRef | undefined => {
    const p = has(id)
    if (!p) return undefined
    return { provider: id, model: id === 'claude' ? 'opus' : p.models[0] }
  }
  const agentic = ready.filter((p) => p.agentic)
  const fallback = agentic[0] ? { provider: agentic[0].id, model: agentic[0].models[0] } : ready[0] ? { provider: ready[0].id, model: ready[0].models[0] } : undefined
  const analysis = first('claude') ?? first('gemini') ?? fallback
  const coding = first('codex') ?? first('claude') ?? fallback
  return { analysis, coding, single: first('claude') ?? coding }
}
