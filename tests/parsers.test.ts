import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createParser, extractErrorMessage, stripAnsi, type ParsedEvent } from '../src/main/parsers.ts'

const feed = (kind: Parameters<typeof createParser>[0], lines: unknown[]): ParsedEvent[] => {
  const p = createParser(kind)
  return [...lines.flatMap((l) => p.line(typeof l === 'string' ? l : JSON.stringify(l))), ...p.end()]
}
const text = (events: ParsedEvent[]) =>
  events
    .filter((e) => e.type === 'text')
    .map((e) => (e as { text: string }).text)
    .join('')

test('claude: akışlı metin, resume kimliği, araç olayı ve kullanım', () => {
  const ev = feed('claude-stream', [
    { type: 'system', subtype: 'hook_started' },
    { type: 'system', subtype: 'init', session_id: 'S1' },
    { type: 'stream_event', event: { type: 'message_start' } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Mer' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'haba' } } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Merhaba' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts' } }] } },
    { type: 'stream_event', event: { type: 'message_start' } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Bitti' } } },
    { type: 'result', subtype: 'success', is_error: false, result: 'Bitti', session_id: 'S1', total_cost_usd: 0.5, usage: { input_tokens: 2, cache_read_input_tokens: 8, output_tokens: 3 } }
  ])
  assert.equal(text(ev), 'Merhaba\n\nBitti')
  assert.deepEqual(ev.find((e) => e.type === 'resume'), { type: 'resume', id: 'S1' })
  assert.deepEqual(ev.find((e) => e.type === 'event'), { type: 'event', event: { kind: 'file', label: 'Edit', detail: 'a.ts' } })
  assert.deepEqual(ev.find((e) => e.type === 'usage'), { type: 'usage', usage: { inputTokens: 10, outputTokens: 3, costUsd: 0.5 } })
  assert.ok(!ev.some((e) => e.type === 'error'))
})

test('claude/cursor: kısmi mesaj yoksa tam assistant metni kullanılır', () => {
  const ev = feed('claude-stream', [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Bir' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'İki' }] } },
    { type: 'result', subtype: 'success', result: 'İki' }
  ])
  assert.equal(text(ev), 'Bir\n\nİki')
})

test('claude: hata sonucu error olayı üretir', () => {
  const ev = feed('claude-stream', [{ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Kota aşıldı' }])
  assert.deepEqual(ev.at(-1), { type: 'error', message: 'Kota aşıldı' })
})

test('claude: JSON olmayan satırlar yok sayılır', () => {
  assert.deepEqual(feed('claude-stream', ['Loading…', '{bozuk']), [])
})

test('codex: thread, mesaj, komut, dosya ve kullanım', () => {
  const ev = feed('codex-json', [
    { type: 'thread.started', thread_id: 'T1' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'i0', type: 'reasoning', text: 'düşünüyorum' } },
    { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'npm test', exit_code: 1 } },
    { type: 'item.completed', item: { id: 'i2', type: 'file_change', changes: [{ path: 'x.ts', kind: 'update' }] } },
    { type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: 'Tamam' } },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 20 } }
  ])
  assert.equal(text(ev), 'Tamam')
  assert.deepEqual(ev[0], { type: 'resume', id: 'T1' })
  const events = ev.filter((e) => e.type === 'event').map((e) => (e as any).event)
  assert.deepEqual(events.map((e) => e.kind), ['thinking', 'tool', 'file'])
  assert.equal(events[1].label, 'Komut (çıkış 1)')
  assert.deepEqual(ev.at(-1), { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } })
})

test('codex: turn.failed iç içe JSON hata mesajını çıkarır', () => {
  const inner = JSON.stringify({ type: 'error', status: 400, error: { message: "The 'x' model is not supported" } })
  const ev = feed('codex-json', [{ type: 'turn.failed', error: { message: inner } }])
  assert.deepEqual(ev, [{ type: 'error', message: "The 'x' model is not supported" }])
})

test('plain: ANSI kaçışlarını temizler ve parçaları olduğu gibi akıtır', () => {
  const p = createParser('plain')
  assert.equal(p.raw, true)
  assert.deepEqual(p.chunk!('\u001b[32mmer\u001b[0mhaba'), [{ type: 'text', text: 'merhaba' }])
  assert.deepEqual(p.chunk!('\u001b[2K'), [])
})

test('yardımcılar', () => {
  assert.equal(stripAnsi('\u001b[1;31mkırmızı\u001b[0m'), 'kırmızı')
  assert.equal(extractErrorMessage('{"error":{"message":"iç"}}'), 'iç')
  assert.equal(extractErrorMessage('düz'), 'düz')
})
