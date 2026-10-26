// Desteklenen yapay zeka CLI'larının tanımları: nasıl bulunur, giriş durumu nasıl anlaşılır,
// modeller nereden okunur ve bir istem için hangi argümanlarla çalıştırılır.
// Hiçbir API anahtarı tutulmaz; her CLI makinede zaten yapılmış olan kendi oturumunu kullanır.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AuthState, Permission, ProviderId, ProviderOverride, ProviderStatus } from '../shared/types.ts'
import { execCapture, findExecutable } from './env.ts'
import type { ParserKind } from './parsers.ts'

export interface BuildOptions {
  model?: string
  permission: Permission
  resumeId?: string
  prompt: string
}

export interface CommandSpec {
  args: string[]
  /** stdin'e yazılacak metin; tanımsızsa istem argüman olarak verilmiştir */
  stdin?: string
}

interface Ctx {
  bin: string
  env: NodeJS.ProcessEnv
}

export interface ProviderDef {
  id: ProviderId
  name: string
  vendor: string
  bins: string[]
  parser: ParserKind
  agentic: boolean
  supportsResume: boolean
  /** Model seçilmeden çalışamayan sağlayıcılar (ör. ollama) */
  requiresModel?: boolean
  installHint: string
  loginHint: string
  checkAuth(ctx: Ctx): Promise<{ auth: AuthState; detail?: string }>
  listModels(ctx: Ctx): Promise<string[]>
  build(o: BuildOptions): CommandSpec
}

const home = homedir()

function readJson(path: string): any | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function firstLine(s: string): string {
  return s.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? ''
}

function geminiLikeAuth(dir: string, envKeys: string[]): { auth: AuthState; detail?: string } {
  if (existsSync(join(home, dir, 'oauth_creds.json'))) return { auth: 'ok', detail: 'OAuth hesabı' }
  const key = envKeys.find((k) => process.env[k])
  if (key) return { auth: 'ok', detail: `${key} ortam değişkeni` }
  const settings = readJson(join(home, dir, 'settings.json'))
  const selected = settings?.security?.auth?.selectedType ?? settings?.selectedAuthType
  if (selected) return { auth: 'unknown', detail: `Yöntem: ${selected}` }
  return { auth: 'missing', detail: 'Oturum bulunamadı' }
}

function geminiLikeBuild(o: BuildOptions): CommandSpec {
  const args: string[] = []
  if (o.model) args.push('-m', o.model)
  if (o.permission === 'edit') args.push('--approval-mode', 'auto_edit')
  if (o.permission === 'full') args.push('--yolo')
  return { args, stdin: o.prompt }
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    vendor: 'Anthropic',
    bins: ['claude'],
    parser: 'claude-stream',
    agentic: true,
    supportsResume: true,
    installHint: 'npm install -g @anthropic-ai/claude-code',
    loginHint: 'claude  →  /login',
    async checkAuth({ bin, env }) {
      const r = await execCapture(bin, ['auth', 'status'], { env, timeoutMs: 15000 })
      try {
        const j = JSON.parse(r.stdout)
        if (j.loggedIn) return { auth: 'ok', detail: [j.authMethod, j.subscriptionType].filter(Boolean).join(' · ') }
        return { auth: 'missing', detail: 'Giriş yapılmamış' }
      } catch {
        if (existsSync(join(home, '.claude', '.credentials.json'))) return { auth: 'ok', detail: 'Kimlik dosyası bulundu' }
        return { auth: 'unknown' }
      }
    },
    async listModels() {
      return ['opus', 'sonnet', 'haiku', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']
    },
    build(o) {
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']
      if (o.model) args.push('--model', o.model)
      if (o.permission === 'read') args.push('--permission-mode', 'default')
      if (o.permission === 'edit') args.push('--permission-mode', 'acceptEdits')
      if (o.permission === 'full') args.push('--dangerously-skip-permissions')
      if (o.resumeId) args.push('--resume', o.resumeId)
      return { args, stdin: o.prompt }
    }
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    vendor: 'OpenAI',
    bins: ['codex'],
    parser: 'codex-json',
    agentic: true,
    supportsResume: true,
    installHint: 'npm install -g @openai/codex',
    loginHint: 'codex login',
    async checkAuth({ bin, env }) {
      const r = await execCapture(bin, ['login', 'status'], { env, timeoutMs: 15000 })
      const text = firstLine(r.stdout + '\n' + r.stderr)
      if (r.code === 0 && !/not logged in/i.test(text)) return { auth: 'ok', detail: text }
      return { auth: 'missing', detail: text || 'Giriş yapılmamış' }
    },
    async listModels() {
      const cache = readJson(join(process.env.CODEX_HOME ?? join(home, '.codex'), 'models_cache.json'))
      const models: string[] = (cache?.models ?? [])
        .filter((m: any) => m.slug && m.visibility !== 'hide')
        .map((m: any) => m.slug)
      return models
    },
    build(o) {
      const args = ['exec']
      if (o.resumeId) args.push('resume')
      args.push('--json', '--skip-git-repo-check')
      if (o.model) args.push('-m', o.model)
      if (o.permission === 'full') args.push('--dangerously-bypass-approvals-and-sandbox')
      else args.push('-c', `sandbox_mode="${o.permission === 'edit' ? 'workspace-write' : 'read-only'}"`)
      if (o.resumeId) args.push(o.resumeId)
      args.push('-')
      return { args, stdin: o.prompt }
    }
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    vendor: 'Google',
    bins: ['gemini'],
    parser: 'plain',
    agentic: true,
    supportsResume: false,
    installHint: 'npm install -g @google/gemini-cli',
    loginHint: 'gemini  →  Login with Google',
    async checkAuth() {
      return geminiLikeAuth('.gemini', ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI'])
    },
    async listModels() {
      return ['gemini-2.5-pro', 'gemini-2.5-flash']
    },
    build: geminiLikeBuild
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    vendor: 'Alibaba',
    bins: ['qwen'],
    parser: 'plain',
    agentic: true,
    supportsResume: false,
    installHint: 'npm install -g @qwen-code/qwen-code',
    loginHint: 'qwen  →  Qwen OAuth',
    async checkAuth() {
      return geminiLikeAuth('.qwen', ['DASHSCOPE_API_KEY', 'OPENAI_API_KEY'])
    },
    async listModels() {
      return ['qwen3-coder-plus']
    },
    build: geminiLikeBuild
  },
  {
    id: 'cursor',
    name: 'Cursor Agent',
    vendor: 'Cursor',
    bins: ['cursor-agent'],
    parser: 'claude-stream',
    agentic: true,
    supportsResume: true,
    installHint: 'curl https://cursor.com/install -fsS | bash',
    loginHint: 'cursor-agent login',
    async checkAuth({ bin, env }) {
      const r = await execCapture(bin, ['status'], { env, timeoutMs: 15000 })
      const text = (r.stdout + r.stderr).trim()
      if (/not logged in|login required/i.test(text)) return { auth: 'missing', detail: firstLine(text) }
      if (r.code === 0) return { auth: 'ok', detail: firstLine(text) }
      return { auth: 'unknown', detail: firstLine(text) }
    },
    async listModels() {
      return ['auto', 'sonnet-4.5', 'gpt-5']
    },
    build(o) {
      const args = ['-p', '--output-format', 'stream-json']
      if (o.model) args.push('--model', o.model)
      if (o.permission !== 'read') args.push('--force')
      if (o.resumeId) args.push('--resume', o.resumeId)
      args.push(o.prompt)
      return { args }
    }
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    vendor: 'GitHub',
    bins: ['copilot'],
    parser: 'plain',
    agentic: true,
    supportsResume: false,
    installHint: 'npm install -g @github/copilot',
    loginHint: 'copilot  →  /login',
    async checkAuth() {
      const cfg = readJson(join(process.env.XDG_CONFIG_HOME ?? join(home, '.copilot'), 'config.json'))
      if (cfg?.logged_in_users?.length || cfg?.last_logged_in_user) return { auth: 'ok', detail: 'GitHub hesabı' }
      if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return { auth: 'ok', detail: 'GitHub token' }
      return { auth: 'unknown', detail: 'Giriş durumu doğrulanamadı' }
    },
    async listModels() {
      return []
    },
    build(o) {
      const args = ['-p', o.prompt]
      if (o.model) args.push('--model', o.model)
      if (o.permission === 'edit') args.push('--allow-tool', 'write')
      if (o.permission === 'full') args.push('--allow-all-tools')
      return { args }
    }
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    vendor: 'SST',
    bins: ['opencode'],
    parser: 'plain',
    agentic: true,
    supportsResume: false,
    installHint: 'npm install -g opencode-ai',
    loginHint: 'opencode auth login',
    async checkAuth() {
      const base = process.platform === 'win32' ? join(home, '.local', 'share') : (process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'))
      const auth = readJson(join(base, 'opencode', 'auth.json'))
      const providers = auth ? Object.keys(auth) : []
      if (providers.length) return { auth: 'ok', detail: providers.join(', ') }
      return { auth: 'unknown', detail: 'Kayıtlı sağlayıcı bulunamadı' }
    },
    async listModels({ bin, env }) {
      const r = await execCapture(bin, ['models'], { env, timeoutMs: 15000 })
      return r.code === 0 ? r.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[\w.-]+\/[\w.:-]+$/.test(l)).slice(0, 60) : []
    },
    build(o) {
      const args = ['run']
      if (o.model) args.push('-m', o.model)
      args.push(o.prompt)
      return { args }
    }
  },
  {
    id: 'ollama',
    name: 'Ollama',
    vendor: 'Yerel modeller',
    bins: ['ollama'],
    parser: 'plain',
    agentic: false,
    supportsResume: false,
    requiresModel: true,
    installHint: 'https://ollama.com/download',
    loginHint: 'ollama signin  (yalnızca :cloud modeller için)',
    async checkAuth({ bin, env }) {
      const r = await execCapture(bin, ['list'], { env, timeoutMs: 10000 })
      if (r.code === 0) return { auth: 'ok', detail: 'Yerel servis çalışıyor' }
      return { auth: 'missing', detail: 'Ollama servisi çalışmıyor (ollama serve)' }
    },
    async listModels({ bin, env }) {
      const r = await execCapture(bin, ['list'], { env, timeoutMs: 10000 })
      if (r.code !== 0) return []
      return r.stdout
        .split(/\r?\n/)
        .slice(1)
        .map((l) => l.trim().split(/\s+/)[0])
        .filter(Boolean)
    },
    build(o) {
      return { args: ['run', o.model ?? '', '--hidethinking', '--nowordwrap'], stdin: o.prompt }
    }
  }
]

export function getProvider(id: ProviderId): ProviderDef {
  const p = PROVIDERS.find((x) => x.id === id)
  if (!p) throw new Error(`Bilinmeyen sağlayıcı: ${id}`)
  return p
}

export function resolveBinary(def: ProviderDef, env: NodeJS.ProcessEnv, override?: ProviderOverride): string | undefined {
  if (override?.path && existsSync(override.path)) return override.path
  return findExecutable(def.bins, env)
}

/** Tek bir sağlayıcıyı tarar: kurulu mu, sürüm, giriş durumu, modeller. */
export async function scanProvider(
  def: ProviderDef,
  env: NodeJS.ProcessEnv,
  override?: ProviderOverride
): Promise<ProviderStatus> {
  const base: ProviderStatus = {
    id: def.id,
    name: def.name,
    vendor: def.vendor,
    installed: false,
    auth: 'unknown',
    models: [],
    installHint: def.installHint,
    loginHint: def.loginHint,
    agentic: def.agentic,
    scannedAt: Date.now()
  }
  const bin = resolveBinary(def, env, override)
  if (!bin) return { ...base, error: 'PATH üzerinde bulunamadı' }

  const v = await execCapture(bin, ['--version'], { env, timeoutMs: 15000 })
  const out = (v.stdout + '\n' + v.stderr).trim()
  if (v.code !== 0 || v.timedOut) {
    return { ...base, path: bin, error: firstLine(out) || (v.timedOut ? 'Sürüm sorgusu zaman aşımına uğradı' : 'Çalıştırılamadı') }
  }
  const version = /\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/.exec(out)?.[0] ?? firstLine(out)

  const ctx = { bin, env }
  const [auth, models] = await Promise.all([
    def.checkAuth(ctx).catch(() => ({ auth: 'unknown' as AuthState, detail: undefined })),
    def.listModels(ctx).catch(() => [] as string[])
  ])
  return { ...base, installed: true, path: bin, version, auth: auth.auth, authDetail: auth.detail, models }
}
