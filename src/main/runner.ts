// Tek bir CLI sürecini başlatır, stdout'u ayrıştırıcıdan geçirip olayları akıtır, iptal ve zaman aşımını yönetir.

import { StringDecoder } from 'node:string_decoder'
import spawn from 'cross-spawn'
import { killTree } from './env.ts'
import type { OutputParser, ParsedEvent } from './parsers.ts'
import type { CommandSpec } from './providers.ts'

export interface RunOutcome {
  status: 'done' | 'error' | 'cancelled'
  error?: string
  stderr?: string
  exitCode?: number | null
}

export interface RunHandle {
  cancel(): void
  done: Promise<RunOutcome>
}

export interface RunCliOptions {
  bin: string
  spec: CommandSpec
  cwd: string
  env: NodeJS.ProcessEnv
  parser: OutputParser
  timeoutMs: number
  onEvents(events: ParsedEvent[]): void
}

const STDERR_LIMIT = 32 * 1024

export function runCli(o: RunCliOptions): RunHandle {
  let cancelled = false
  let timedOut = false
  let parserError: string | undefined
  let stderr = ''
  let buffer = ''
  const decoder = new StringDecoder('utf8')

  const child = spawn(o.bin, o.spec.args, {
    cwd: o.cwd,
    env: o.env,
    windowsHide: true,
    // Unix'te süreç grubunu toplu sonlandırabilmek için ayrı grup
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe']
  })

  const emit = (events: ParsedEvent[]): void => {
    if (!events.length) return
    for (const e of events) if (e.type === 'error') parserError = e.message
    o.onEvents(events)
  }

  const handleData = (data: Buffer | string): void => {
    const s = typeof data === 'string' ? data : decoder.write(data)
    if (o.parser.raw && o.parser.chunk) {
      emit(o.parser.chunk(s))
      return
    }
    buffer += s
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '')
      buffer = buffer.slice(nl + 1)
      if (line.trim()) emit(o.parser.line(line))
    }
  }

  const timer = setTimeout(() => {
    timedOut = true
    killTree(child.pid)
  }, o.timeoutMs)

  const done = new Promise<RunOutcome>((resolve) => {
    child.stdout?.on('data', handleData)
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < STDERR_LIMIT) stderr += d.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ status: 'error', error: `Süreç başlatılamadı: ${err.message}`, stderr })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const rest = decoder.end()
      if (rest) handleData(rest)
      if (buffer.trim() && !o.parser.raw) emit(o.parser.line(buffer))
      buffer = ''
      emit(o.parser.end())

      if (cancelled) return resolve({ status: 'cancelled', stderr, exitCode: code })
      if (timedOut) return resolve({ status: 'error', error: 'Zaman aşımı: süreç sonlandırıldı', stderr, exitCode: code })
      if (parserError) return resolve({ status: 'error', error: parserError, stderr, exitCode: code })
      if (code !== 0) {
        const tail = stderr.trim().split(/\r?\n/).slice(-6).join('\n')
        return resolve({ status: 'error', error: tail || `Süreç ${code} koduyla çıktı`, stderr, exitCode: code })
      }
      resolve({ status: 'done', stderr, exitCode: code })
    })
  })

  // Uzun istemler ve Windows'taki argüman kaçışı sorunları nedeniyle istem tercihen stdin ile verilir.
  child.stdin?.on('error', () => {
    // süreç stdin'i okumadan kapandıysa EPIPE oluşur; sonuç 'close' içinde raporlanır
  })
  if (o.spec.stdin != null) child.stdin?.end(o.spec.stdin, 'utf8')
  else child.stdin?.end()

  return {
    done,
    cancel() {
      if (cancelled) return
      cancelled = true
      killTree(child.pid)
    }
  }
}
