/**
 * You Should Know — the desktop half, driven like the app drives it (plain node, no browser needed:
 * the plugin draws nothing of its own; it calls ctx.rest and host.notify).
 *
 * Run: node render_check.mjs [path/to/plugin.js]      (exit 0 = passed)
 *
 * Locks:
 *   1. Registration: no page, no pane, no nav row; the English bundle; one message.complete listener;
 *      focus listeners are retired on dispose.
 *   2. Which replies: status complete, not a reused reply, a string of at least 3000 characters,
 *      in a chat the user has opened in this app. A subagent mirror (no status), an error, a short
 *      reply or a chat never opened is never sent.
 *   3. Once per reply: the same text again is not checked twice; a reply differing only at its end
 *      is a different reply (the key covers the whole text).
 *   4. The request: POST /check with exactly { session_id, turn } — the stored id of the reply's OWN
 *      chat (even when another chat is in focus) and the frame's persisted_turn receipt as is; never
 *      the reply's text. A frame without a receipt still posts, with turn: null (the backend's
 *      refusal becomes the error notice, never a silent skip).
 *   5. The notice (a chat is filed under its own stored id whatever order the app sets the focus
 *      atoms in): warning kind (stays until dismissed), the one point as the message with its kind
 *      named and no detail, the cost as meta; "Open chat" only when the reply's chat is not the
 *      focused one, and it opens that chat.
 *   6. Nothing to flag -> no notice. A failed check -> one error notice that names the error.
 *   7. Pet: a line only when a pet is on screen.
 *   8. Copy: every key the source asks for resolves (no raw key on screen); the six kinds (tradeoff,
 *      result, assumption, irreversible, security, cost) have their labels and the retired ones
 *      (action, deadline) are gone; an unknown kind shows the point without a label, never a key.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = process.argv[2] ? path.resolve(process.argv[2]) : path.join(HERE, '..', 'desktop', 'plugin.js')
const OUT = path.join(HERE, '.out', process.env.YSK_RENDER_OUT || 'main')
mkdirSync(OUT, { recursive: true })

writeFileSync(path.join(OUT, 'sdk-stub.mjs'), `
function atom(v) {
  const subs = new Set()
  return { get: () => v, set: n => { v = n; subs.forEach(f => f()) }, listen: f => { subs.add(f); return () => subs.delete(f) }, subs }
}
export const calls = { notify: [], opened: [] }
export const host = {
  state: { focusedSessionId: atom('rt-1'), focusedStoredSessionId: atom('st-1') },
  notify: n => { calls.notify.push(n) },
  openSession: async sid => { calls.opened.push(sid) }
}
`)
const source = readFileSync(SRC, 'utf8')
writeFileSync(path.join(OUT, 'plugin-under-test.mjs'), source.replace("'@hermes/plugin-sdk'", `'${pathToFileURL(path.join(OUT, 'sdk-stub.mjs')).href}'`))
const stub = await import(pathToFileURL(path.join(OUT, 'sdk-stub.mjs')).href)
const mod = await import(pathToFileURL(path.join(OUT, 'plugin-under-test.mjs')).href)

let failures = 0
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`)
  if (!ok) failures++
}
const settle = () => new Promise(r => setTimeout(r, 0))

// ── fake ctx ────────────────────────────────────────────────────────────────
const registered = []
const listeners = new Map()
const disposers = []
const rest = []
let reply = { points: [], cost_usd: 0.0213, cost_status: 'estimated' }
let restFails = null
const pet = { visible: false, said: [] }
const ctx = {
  register: c => { registered.push(c); return () => {} },
  i18n: { register: b => { ctx.bundle = b } },
  onEvent: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type).delete(fn) },
  onDispose: fn => { disposers.push(fn) },
  rest: async (p, opts) => {
    rest.push([p, opts])
    if (restFails) throw new Error(restFails)
    return reply
  },
  pet: { visible: { get: () => pet.visible }, say: (text, opts) => { pet.said.push([text, opts]) } }
}
const emit = async (session_id, payload) => {
  for (const fn of listeners.get('message.complete') || []) fn({ type: 'message.complete', session_id, payload })
  await settle()
  await settle()
}
const LONG = 'A'.repeat(2990) + ' — the end of a long reply.'
const long = tag => `${LONG} ${tag}`
// The frame's receipt, as tui_gateway's _persisted_turn_receipt sends it.
const receipt = base => ({ row_ids: [base, base + 1, base + 2], complete: true, user_row_id: base, final_assistant_row_id: base + 2 })
const frame = (tag, base) => ({ status: 'complete', text: long(tag), persisted_turn: receipt(base) })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// 1. registration
mod.default.register(ctx)
check(registered.length === 0, 'no page, pane or nav row is registered (the plugin draws nothing of its own)')
check(ctx.bundle?.en?.ysk?.title === 'You should know', 'the English bundle is registered')
check(listeners.get('message.complete')?.size === 1 && listeners.size === 1, 'one listener, on message.complete only')
check(stub.host.state.focusedSessionId.subs.size === 1 && stub.host.state.focusedStoredSessionId.subs.size === 1, 'focus is followed')

// 2. which replies
check(mod.eligible({ status: 'complete', text: long('x') }), 'a complete long reply is eligible')
check(!mod.eligible({ text: long('x') }), 'a subagent mirror (no status) is not')
check(!mod.eligible({ status: 'error', text: long('x') }) && !mod.eligible({ status: 'interrupted', text: long('x') }), 'an error or interrupted turn is not')
check(!mod.eligible({ status: 'complete', text: long('x'), response_reused: true }), 'a reply this turn already delivered is not')
check(!mod.eligible({ status: 'complete', text: 'A'.repeat(2999) }) && mod.eligible({ status: 'complete', text: 'A'.repeat(3000) }), 'the floor is 3000 characters, inclusive')
check(!mod.eligible({ status: 'complete', text: { parts: [long('x')] } }), 'a non-string text is not')

await emit('rt-never', { status: 'complete', text: long('never') })
check(rest.length === 0, 'a reply in a chat never opened here is not sent')
await emit('rt-1', { text: long('mirror') })
check(rest.length === 0, 'a mirror frame is not sent')

// 3/4/5. a checked reply with a point, in the focused chat
reply = { points: [{ kind: 'tradeoff', by: 'assistant', text: 'The assistant chose SQLite over Postgres without saying it drops concurrent writes.' }], cost_usd: 0.0213, cost_status: 'estimated' }
await emit('rt-1', frame('one', 10))
const body1 = rest[0]?.[1]?.body
check(rest.length === 1 && rest[0][0] === '/check' && rest[0][1]?.method === 'POST', 'a long reply of the focused chat is sent to POST /check')
check(same(Object.keys(body1 || {}).sort(), ['session_id', 'turn']) && body1.session_id === 'st-1' && same(body1.turn, receipt(10)),
  `the body is { session_id, turn }: the chat's stored id and the frame's receipt as is (${JSON.stringify(body1)})`)
check(!('text' in (body1 || {})) && !JSON.stringify(body1).includes(LONG.slice(0, 50)), 'the reply\'s text is not sent')
let n = stub.calls.notify.at(-1)
check(n?.kind === 'warning' && n?.title === 'You should know', `a warning notice (stays until dismissed) titled "You should know" (${n?.kind})`)
check(n?.message === 'Tradeoff: The assistant chose SQLite over Postgres without saying it drops concurrent writes.', `the one point is the message, its kind named (${n?.message})`)
check(n && !('detail' in n), `one point: no detail (${JSON.stringify(n?.detail)})`)
check(n?.meta === 'Checked by Opus · ~$0.02', `the meta names the check and its cost (${n?.meta})`)
check(!n?.action, 'no "Open chat" for the chat already in focus')
check(pet.said.length === 0, 'no pet on screen -> nothing is said')
const shown = stub.calls.notify.length
await emit('rt-1', frame('one', 10))
check(rest.length === 1 && stub.calls.notify.length === shown, 'the same reply is checked once')
check(mod.replyKey(long('one')) !== mod.replyKey(long('onf')) && mod.replyKey('ab') !== mod.replyKey('ba'), 'a reply differing only at its end is a different reply')

// 4/5. a reply in another chat the user opened earlier
// The app sets the stored atom first here: the pair is read once both have settled.
stub.host.state.focusedStoredSessionId.set('st-2')
stub.host.state.focusedSessionId.set('rt-2')
await settle()
pet.visible = true
reply = { points: [{ kind: 'irreversible', by: 'user', text: 'You asked to delete the old backups; the reply calls it a cleanup.' }], cost_usd: 0.004, cost_status: 'estimated' }
await emit('rt-1', frame('two', 20))
const body2 = rest.at(-1)?.[1]?.body
check(body2?.session_id === 'st-1' && same(body2?.turn, receipt(20)),
  `a reply finishing in a chat not in focus sends THAT chat's stored id, not the focused one (${body2?.session_id})`)
n = stub.calls.notify.at(-1)
check(n?.message === 'Cannot be undone: You asked to delete the old backups; the reply calls it a cleanup.' && n?.detail === undefined && n?.meta === 'Checked by Opus · <$0.01',
  `one point, no detail, a sub-cent cost (${n?.message} | ${n?.meta})`)
check(n?.action?.label === 'Open chat', 'a reply in a chat not in focus offers "Open chat"')
n?.action?.onClick()
await settle()
check(stub.calls.opened.at(-1) === 'st-1', `"Open chat" opens the reply's own chat (${stub.calls.opened.at(-1)})`)
check(pet.said.length === 1 && pet.said[0][0] === 'You should know: 1 point in the notice', `with a pet on screen it points to the notice (${JSON.stringify(pet.said)})`)
check(n?.id !== stub.calls.notify[shown - 1]?.id, 'each reply gets its own notice')

// 6. nothing to flag; a failed check
const before = stub.calls.notify.length
reply = { points: [], cost_usd: 0.02, cost_status: 'estimated' }
await emit('rt-2', frame('three', 30))
check(rest.length === 3 && stub.calls.notify.length === before, 'nothing to flag -> no notice')
restFails = 'model call failed (APITimeoutError)'
const warn = console.warn
console.warn = () => {}
await emit('rt-2', frame('four', 40))
n = stub.calls.notify.at(-1)
check(n?.kind === 'error' && n?.id === 'you-should-know-error' && n?.message === 'Could not check a long reply: model call failed (APITimeoutError)',
  `a failed check is one error notice that names the error (${n?.message})`)
// 4. a frame without a receipt (a core before persisted_turn) still posts; the refusal is the error notice
restFails = 'turn ids missing or malformed'
await emit('rt-2', { status: 'complete', text: long('no receipt') })
console.warn = warn
const body3 = rest.at(-1)?.[1]?.body
check(rest.length === 5 && body3?.session_id === 'st-2' && 'turn' in body3 && body3.turn === null,
  `a frame without a receipt still posts, with turn: null (${JSON.stringify(body3)})`)
n = stub.calls.notify.at(-1)
check(n?.kind === 'error' && n?.message === 'Could not check a long reply: turn ids missing or malformed', `the refusal is the error notice, never a silent skip (${n?.message})`)
restFails = null
check(mod.fmtCost(null, 'unknown') === '' && mod.fmtCost(0.7, 'unknown') === '' && mod.fmtCost(0, 'included') === 'subscription' && mod.fmtCost(0.38, 'actual') === '$0.38',
  'cost text: unpriced is empty even with an amount stored, subscription named, billed as is')
check(mod.noticeFor({ points: [], cost_usd: 1, cost_status: 'estimated' }, { key: 'k' }) === null, 'no points -> no notice')
reply = { points: [{ kind: 'security', by: 'assistant', text: 'The token is in the log.' }], cost_usd: null, cost_status: 'unknown' }
await emit('rt-2', frame('five', 50))
check(stub.calls.notify.at(-1)?.meta === 'Checked by Opus', `an unpriced check names no cost, never $0 (${stub.calls.notify.at(-1)?.meta})`)

// 8. every key the source asks for resolves; the six kinds have their labels
const keys = [...source.matchAll(/\bt\('([a-z.]+)'/g)].map(m => m[1])
const raw = keys.filter(k => mod.t(k, 1, 'x') === k)
check(keys.length >= 5 && raw.length === 0, `every t() key resolves (${keys.length} keys${raw.length ? `, raw: ${raw}` : ''})`)
const LABELS = { tradeoff: 'Tradeoff', result: 'Result may be off', assumption: 'Assumption', irreversible: 'Cannot be undone', security: 'Security', cost: 'Cost' }
const labels = Object.keys(LABELS).map(k => mod.t(`ysk.kind.${k}`))
check(same(labels, Object.values(LABELS)), `the six kind labels resolve (${labels.join(' | ')})`)
check(mod.t('ysk.kind.action') === 'ysk.kind.action' && mod.t('ysk.kind.deadline') === 'ysk.kind.deadline' && !/\b(action|deadline):\s*'/.test(source),
  'the retired kinds action and deadline are no longer listed')
const odd = mod.noticeFor({ points: [{ kind: 'nonsense', by: 'assistant', text: 'Odd kind.' }] }, { key: 'k' })
check(odd?.message === 'Odd kind.', `an unknown kind shows the point without a label, never a raw key (${odd?.message})`)

// 1. dispose
disposers.forEach(fn => fn())
check(stub.host.state.focusedSessionId.subs.size === 0 && stub.host.state.focusedStoredSessionId.subs.size === 0, 'dispose retires the focus listeners')

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
process.exitCode = failures ? 1 : 0
