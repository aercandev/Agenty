// CLI çıktılarını ortak olay modeline çeviren saf (electron'dan bağımsız) ayrıştırıcılar.
// Bağımsız oldukları için `npm test` ile doğrudan Node üzerinde test edilebilirler.

import type { RunEvent, RunUsage } from '../shared/types.ts'

export type ParsedEvent =
  | { type: 'text'; text: string }
  | { type: 'event'; event: Omit<RunEvent, 'at'> }
  | { type: 'resume'; id: string }
  | { type: 'usage'; usage: RunUsage }
  | { type: 'error'; message: string }

export interface OutputParser {
  /** true → stdout satır beklenmeden parça parça `chunk` ile beslenir */
  raw?: boolean
  line(line: string): ParsedEvent[]
  chunk?(data: string): ParsedEvent[]
  end(): ParsedEvent[]
}

export type ParserKind = 'claude-stream' | 'codex-json' | 'plain'

export function createParser(kind: ParserKind): OutputParser {
  switch (kind) {
    case 'claude-stream':
      return new ClaudeStreamParser()
    case 'codex-json':
      return new CodexJsonParser()
    default:
      return new PlainParser()
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

function tryJson(line: string): any | undefined {
  const t = line.trim()
  if (!t.startsWith('{')) return undefined
  try {
    return JSON.parse(t)
  } catch {
    return undefined
  }
}

function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

/** API hataları çoğu zaman JSON string içinde JSON olarak gelir; okunabilir mesajı çıkarır. */
export function extractErrorMessage(raw: unknown): string {
  if (typeof raw !== 'string') return raw == null ? 'Bilinmeyen hata' : String(raw)
  const j = tryJson(raw)
  if (j) return j.error?.message ?? j.message ?? raw
  return raw
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'edit_file', 'write_file'])

function describeToolInput(name: string, input: any): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const v =
    input.command ?? input.file_path ?? input.path ?? input.notebook_path ?? input.pattern ?? input.url ?? input.query ?? input.description
  if (typeof v === 'string') return truncate(v, 160)
  try {
    return truncate(JSON.stringify(input), 160)
  } catch {
    return name
  }
}

/**
 * Claude Code `--output-format stream-json` (ve aynı biçimi kullanan cursor-agent) ayrıştırıcısı.
 * `--include-partial-messages` varsa metin text_delta ile akar; yoksa tam assistant mesajlarından alınır.
 */
class ClaudeStreamParser implements OutputParser {
  private streamed = false
  private emittedText = false
  private needSeparator = false

  line(line: string): ParsedEvent[] {
    const j = tryJson(line)
    if (!j) return []
    const out: ParsedEvent[] = []
    switch (j.type) {
      case 'system':
        if (j.subtype === 'init' && j.session_id) out.push({ type: 'resume', id: j.session_id })
        break
      case 'stream_event': {
        const ev = j.event
        if (ev?.type === 'message_start' && this.emittedText) this.needSeparator = true
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          this.streamed = true
          out.push(this.text(ev.delta.text))
        }
        break
      }
      case 'assistant': {
        const content = Array.isArray(j.message?.content) ? j.message.content : []
        for (const block of content) {
          if (block.type === 'tool_use') {
            out.push({
              type: 'event',
              event: {
                kind: FILE_TOOLS.has(block.name) ? 'file' : 'tool',
                label: block.name,
                detail: describeToolInput(block.name, block.input)
              }
            })
          } else if (block.type === 'text' && block.text && !this.streamed) {
            if (this.emittedText) this.needSeparator = true
            out.push(this.text(block.text))
          }
        }
        break
      }
      case 'result': {
        const u = j.usage
        if (u || j.total_cost_usd != null) {
          out.push({
            type: 'usage',
            usage: {
              inputTokens: u
                ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
                : undefined,
              outputTokens: u?.output_tokens,
              costUsd: j.total_cost_usd
            }
          })
        }
        if (j.session_id) out.push({ type: 'resume', id: j.session_id })
        if (j.is_error || (j.subtype && j.subtype !== 'success')) {
          out.push({ type: 'error', message: extractErrorMessage(j.result ?? j.error ?? j.subtype) })
        } else if (!this.emittedText && typeof j.result === 'string' && j.result) {
          out.push(this.text(j.result))
        }
        break
      }
    }
    return out
  }

  end(): ParsedEvent[] {
    return []
  }

  private text(t: string): ParsedEvent {
    const prefix = this.needSeparator ? '\n\n' : ''
    this.needSeparator = false
    this.emittedText = true
    return { type: 'text', text: prefix + t }
  }
}

/** OpenAI Codex `codex exec --json` JSONL ayrıştırıcısı. */
class CodexJsonParser implements OutputParser {
  private emittedText = false

  line(line: string): ParsedEvent[] {
    const j = tryJson(line)
    if (!j) return []
    const out: ParsedEvent[] = []
    switch (j.type) {
      case 'thread.started':
        if (j.thread_id) out.push({ type: 'resume', id: j.thread_id })
        break
      case 'item.completed': {
        const it = j.item ?? {}
        switch (it.type) {
          case 'agent_message':
            if (it.text) {
              out.push({ type: 'text', text: (this.emittedText ? '\n\n' : '') + it.text })
              this.emittedText = true
            }
            break
          case 'reasoning':
            if (it.text) out.push({ type: 'event', event: { kind: 'thinking', label: 'Akıl yürütme', detail: truncate(it.text, 240) } })
            break
          case 'command_execution':
            out.push({
              type: 'event',
              event: {
                kind: 'tool',
                label: it.exit_code != null && it.exit_code !== 0 ? `Komut (çıkış ${it.exit_code})` : 'Komut',
                detail: truncate(String(it.command ?? ''), 200)
              }
            })
            break
          case 'file_change':
            for (const c of Array.isArray(it.changes) ? it.changes : []) {
              out.push({ type: 'event', event: { kind: 'file', label: c.kind ?? 'değişiklik', detail: c.path } })
            }
            break
          case 'mcp_tool_call':
            out.push({ type: 'event', event: { kind: 'tool', label: `${it.server ?? 'mcp'}.${it.tool ?? ''}` } })
            break
          case 'web_search':
            out.push({ type: 'event', event: { kind: 'tool', label: 'Web araması', detail: it.query } })
            break
          case 'todo_list':
            out.push({
              type: 'event',
              event: {
                kind: 'info',
                label: 'Yapılacaklar',
                detail: (it.items ?? []).map((t: any) => `${t.completed ? '✓' : '○'} ${t.text}`).join('  ')
              }
            })
            break
          case 'error':
            out.push({ type: 'event', event: { kind: 'warning', label: 'Uyarı', detail: extractErrorMessage(it.message) } })
            break
        }
        break
      }
      case 'turn.completed': {
        const u = j.usage
        if (u) out.push({ type: 'usage', usage: { inputTokens: u.input_tokens, outputTokens: u.output_tokens } })
        break
      }
      case 'turn.failed':
        out.push({ type: 'error', message: extractErrorMessage(j.error?.message ?? j.error) })
        break
      case 'error':
        out.push({ type: 'event', event: { kind: 'warning', label: 'Hata', detail: extractErrorMessage(j.message) } })
        break
    }
    return out
  }

  end(): ParsedEvent[] {
    return []
  }
}

/** Yapılandırılmış çıktı vermeyen CLI'lar için düz metin akışı. */
class PlainParser implements OutputParser {
  raw = true

  chunk(data: string): ParsedEvent[] {
    const t = stripAnsi(data).replace(/\r(?!\n)/g, '')
    return t ? [{ type: 'text', text: t }] : []
  }

  line(line: string): ParsedEvent[] {
    return this.chunk(line + '\n')
  }

  end(): ParsedEvent[] {
    return []
  }
}
