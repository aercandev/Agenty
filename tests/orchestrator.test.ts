import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getProvider } from '../src/main/providers.ts'
import { buildHistory, splitArgs } from '../src/main/orchestrator.ts'
import type { Session, Turn } from '../src/shared/types.ts'

test('splitArgs tırnakları korur', () => {
  assert.deepEqual(splitArgs(`--append-system-prompt "Türkçe yanıt ver" -c a='b c' --x`), [
    '--append-system-prompt',
    'Türkçe yanıt ver',
    '-c',
    'a=b c',
    '--x'
  ])
})

test('buildHistory önceki turları ve son başarılı yanıtı içerir', () => {
  const turn = (id: string, prompt: string, text: string, status: Turn['status'] = 'done'): Turn => ({
    id,
    prompt,
    mode: 'single',
    cwd: '.',
    createdAt: 0,
    status,
    runs: [{ id: id + 'r', role: 'single', model: { provider: 'claude', model: 'opus' }, permission: 'read', status: 'done', text, events: [] }]
  })
  const current = turn('t3', 'yeni', '')
  const s: Session = {
    id: 's',
    title: 't',
    createdAt: 0,
    updatedAt: 0,
    resume: {},
    turns: [turn('t1', 'ilk soru', 'ilk yanıt'), turn('t2', 'iptal', 'x', 'cancelled'), current]
  }
  const h = buildHistory(s, current, 5)
  assert.match(h, /ilk soru/)
  assert.match(h, /ilk yanıt \(|ilk yanıt/)
  assert.match(h, /claude \/ opus/)
  assert.doesNotMatch(h, /iptal/)
  assert.ok(h.endsWith('# Yeni istek\n\n'))
  assert.equal(buildHistory(s, current, 0), '')
})

test('claude argümanları yetki ve resume ile doğru kurulur', () => {
  const c = getProvider('claude').build({ model: 'opus', permission: 'edit', resumeId: 'R', prompt: 'P' })
  assert.deepEqual(c.args.slice(0, 5), ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'])
  assert.ok(c.args.join(' ').includes('--model opus'))
  assert.ok(c.args.join(' ').includes('--permission-mode acceptEdits'))
  assert.ok(c.args.join(' ').includes('--resume R'))
  assert.equal(c.stdin, 'P')
})

test('codex exec ve resume argümanları', () => {
  const codex = getProvider('codex')
  const fresh = codex.build({ permission: 'read', prompt: 'P' })
  assert.deepEqual(fresh.args, ['exec', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '-'])
  const resumed = codex.build({ model: 'm', permission: 'full', resumeId: 'T', prompt: 'P' })
  assert.deepEqual(resumed.args, ['exec', 'resume', '--json', '--skip-git-repo-check', '-m', 'm', '--dangerously-bypass-approvals-and-sandbox', 'T', '-'])
})
