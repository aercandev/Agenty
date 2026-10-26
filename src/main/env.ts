// Süreç ortamı yardımcıları: PATH çözümleme, çalıştırılabilir dosya bulma, komut çalıştırma, süreç ağacı sonlandırma.

import { execFile, spawn as nodeSpawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import spawn from 'cross-spawn'

const isWin = process.platform === 'win32'
let cachedEnv: NodeJS.ProcessEnv | null = null

/**
 * macOS/Linux'ta Finder/Dock'tan açılan GUI uygulamaları kullanıcının shell PATH'ini miras almaz;
 * bu yüzden npm/brew ile kurulan CLI'lar bulunamaz. Login shell'den PATH okunur ve
 * bilinen kurulum klasörleri eklenir.
 */
export async function resolveEnv(): Promise<NodeJS.ProcessEnv> {
  if (cachedEnv) return cachedEnv
  const env: NodeJS.ProcessEnv = { ...process.env }
  const parts = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)

  if (!isWin) {
    const shell = env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
    const shellPath = await new Promise<string>((resolve) => {
      execFile(shell, ['-ilc', 'printf "__AGENTY__%s__AGENTY__" "$PATH"'], { timeout: 5000, env }, (_e, out) => {
        const m = /__AGENTY__(.*)__AGENTY__/.exec(out ?? '')
        resolve(m ? m[1] : '')
      })
    })
    parts.unshift(...shellPath.split(':').filter(Boolean))
  }

  const home = homedir()
  const extra = isWin
    ? [
        join(home, '.local', 'bin'),
        join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'npm'),
        join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Programs', 'Ollama'),
        join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Programs', 'OpenAI', 'Codex', 'bin'),
        join(home, '.bun', 'bin'),
        join(home, 'scoop', 'shims')
      ]
    : [
        join(home, '.local', 'bin'),
        join(home, '.npm-global', 'bin'),
        join(home, '.bun', 'bin'),
        join(home, '.volta', 'bin'),
        join(home, '.cargo', 'bin'),
        join(home, '.opencode', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin'
      ]
  for (const p of extra) if (!parts.includes(p)) parts.push(p)

  const PATH = [...new Set(parts)].join(delimiter)
  if (isWin) {
    delete env.Path
  }
  env.PATH = PATH
  // Agenty bir Claude Code terminalinden açıldıysa iç içe oturum korumasını tetiklememek için temizle.
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT
  env.NO_COLOR = '1'
  env.FORCE_COLOR = '0'
  cachedEnv = env
  return env
}

export function resetEnvCache(): void {
  cachedEnv = null
}

/** PATH (ve Windows'ta PATHEXT) üzerinden çalıştırılabilir dosya arar. */
export function findExecutable(names: string[], env: NodeJS.ProcessEnv): string | undefined {
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean)
  const exts = isWin ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';').filter(Boolean) : ['']
  for (const name of names) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const full = join(dir, name + ext)
        try {
          if (existsSync(full) && statSync(full).isFile()) return full
        } catch {
          // erişilemeyen klasörleri atla
        }
      }
    }
  }
  return undefined
}

export interface ExecResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/** Kısa süreli komutlar (sürüm, auth durumu, model listesi) için çıktı toplayan yardımcı. */
export function execCapture(
  cmd: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; timeoutMs?: number; cwd?: string }
): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let child
    try {
      child = spawn(cmd, args, { env: opts.env, cwd: opts.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e), timedOut: false })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
    }, opts.timeoutMs ?? 10000)
    child.stdout?.on('data', (d) => (stdout += d.toString()))
    child.stderr?.on('data', (d) => (stderr += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + String(e), timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

/** Süreci ve alt süreçlerini sonlandırır (CLI'lar kendi alt süreçlerini başlatır). */
export function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    if (isWin) {
      nodeSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        process.kill(pid, 'SIGTERM')
      }
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          // zaten kapandı
        }
      }, 3000)
    }
  } catch {
    // süreç zaten yok
  }
}
