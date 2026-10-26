// Main ve renderer süreçleri arasında paylaşılan tipler.

export type ProviderId =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'qwen'
  | 'cursor'
  | 'copilot'
  | 'opencode'
  | 'ollama'

/** CLI'a verilecek yetki seviyesi. Her sağlayıcı bunu kendi bayraklarına çevirir. */
export type Permission = 'read' | 'edit' | 'full'

export type AuthState = 'ok' | 'missing' | 'unknown'

export interface ProviderStatus {
  id: ProviderId
  name: string
  vendor: string
  installed: boolean
  path?: string
  version?: string
  auth: AuthState
  authDetail?: string
  models: string[]
  /** Kurulu değilse veya çalışmıyorsa açıklama */
  error?: string
  installHint: string
  loginHint: string
  /** Sağlayıcı dosya düzenleme / komut çalıştırma yapabiliyor mu */
  agentic: boolean
  scannedAt: number
}

export interface ModelRef {
  provider: ProviderId
  /** undefined → CLI'ın kendi varsayılan modeli */
  model?: string
}

export type RunMode = 'single' | 'pipeline' | 'parallel'
export type RunRole = 'analysis' | 'coding' | 'single' | 'parallel'
export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'skipped'

export interface RunEvent {
  kind: 'tool' | 'thinking' | 'info' | 'file' | 'warning'
  label: string
  detail?: string
  at: number
}

export interface RunUsage {
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

export interface Run {
  id: string
  role: RunRole
  model: ModelRef
  permission: Permission
  status: RunStatus
  text: string
  events: RunEvent[]
  startedAt?: number
  endedAt?: number
  usage?: RunUsage
  error?: string
  stderr?: string
  /** Kodlama sonrası çalışma klasöründe değişen dosyalar (git status) */
  changedFiles?: ChangedFile[]
}

export interface ChangedFile {
  status: string
  path: string
}

export type TurnStatus = 'running' | 'awaiting-approval' | 'done' | 'error' | 'cancelled'

export interface Turn {
  id: string
  prompt: string
  mode: RunMode
  cwd: string
  createdAt: number
  status: TurnStatus
  runs: Run[]
}

export interface Session {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pinned?: boolean
  cwd?: string
  turns: Turn[]
  /** `${provider}:${role}` → CLI'ın kendi oturum kimliği (resume için) */
  resume: Record<string, string>
}

export interface SessionSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pinned?: boolean
  cwd?: string
  turnCount: number
  running: boolean
  preview: string
}

export interface SearchHit {
  sessionId: string
  title: string
  snippet: string
  updatedAt: number
}

export interface ProviderOverride {
  enabled: boolean
  /** Elle belirtilen çalıştırılabilir dosya yolu */
  path?: string
  /** Her çağrıya eklenen ekstra argümanlar (boşlukla ayrılmış) */
  extraArgs?: string
}

export interface Settings {
  setupComplete: boolean
  theme: 'dark' | 'light' | 'system'
  defaultCwd: string
  mode: RunMode
  singleModel?: ModelRef
  analysisModel?: ModelRef
  codingModel?: ModelRef
  parallelModels: ModelRef[]
  codingPermission: Permission
  /** Analiz bittiğinde kodlamaya geçmeden önce kullanıcı onayı iste */
  pipelineApproval: boolean
  timeoutMinutes: number
  /** Resume desteklemeyen CLI'lara bağlam olarak gönderilecek önceki tur sayısı */
  historyTurns: number
  fontSize: number
  sidebarWidth: number
  providers: Partial<Record<ProviderId, ProviderOverride>>
}

export interface StartTurnRequest {
  sessionId: string
  prompt: string
  mode: RunMode
  cwd: string
  single?: ModelRef
  analysis?: ModelRef
  coding?: ModelRef
  parallel?: ModelRef[]
  codingPermission: Permission
}

/** Main → renderer artımlı güncelleme (yüksek frekanslı metin akışı için) */
export interface RunDelta {
  sessionId: string
  turnId: string
  runId: string
  appendText?: string
  events?: RunEvent[]
  patch?: Partial<Omit<Run, 'text' | 'events'>>
}

export interface AgentyApi {
  platform: string
  scanProviders(): Promise<ProviderStatus[]>
  getProviders(): Promise<ProviderStatus[]>
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  listSessions(): Promise<SessionSummary[]>
  getSession(id: string): Promise<Session | null>
  createSession(cwd?: string): Promise<Session>
  updateSession(id: string, patch: Partial<Pick<Session, 'title' | 'pinned' | 'cwd'>>): Promise<Session | null>
  deleteSession(id: string): Promise<void>
  searchSessions(query: string): Promise<SearchHit[]>
  exportSession(id: string): Promise<string | null>
  startTurn(req: StartTurnRequest): Promise<string>
  cancelTurn(sessionId: string, turnId: string): Promise<void>
  continuePipeline(sessionId: string, turnId: string, approved: boolean): Promise<void>
  pickFolder(defaultPath?: string): Promise<string | null>
  openPath(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  onRunDelta(cb: (d: RunDelta) => void): () => void
  onSessionChanged(cb: (s: Session) => void): () => void
  onSessionsListChanged(cb: (list: SessionSummary[]) => void): () => void
}
