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
 *   4. The notice (a chat is filed under its own stored id whatever order the app sets the focus
 *      atoms in): warning kind (stays until dismissed), the first point as the message with its kind
 *      named, the others as the detail, the cost as meta; "Open chat" only when the reply's chat is
 *      not the focused one, and it opens that chat.
 *   5. Nothing to flag -> no notice. A failed check -> one error notice that names the error.
 *   6. Pet: a line only when a pet is on screen.
 *   7. Copy: every key the source asks for resolves (no raw key on screen); an unknown kind shows the
 *      point without a label, never a key.
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

// 3/4. a checked reply with points, in the focused chat
reply = { points: [{ kind: 'cost', text: 'Running it costs ~$30 a month.' }, { kind: 'action', text: 'Restart the app.' }, { kind: 'nonsense', text: 'Odd kind.' }], cost_usd: 0.0213, cost_status: 'estimated' }
await emit('rt-1', { status: 'complete', text: long('one') })
check(rest.length === 1 && rest[0][0] === '/check' && rest[0][1]?.method === 'POST' && rest[0][1]?.body?.text === long('one'),
  'a long reply of the focused chat is sent whole to POST /check')
let n = stub.calls.notify.at(-1)
check(n?.kind === 'warning' && n?.title === 'You should know', `a warning notice (stays until dismissed) titled "You should know" (${n?.kind})`)
check(n?.message === 'Cost: Running it costs ~$30 a month.', `the first point is the message, its kind named (${n?.message})`)
check(n?.detail === '• Your move: Restart the app.\n• Odd kind.', `the other points are the detail; an unknown kind shows no raw key (${JSON.stringify(n?.detail)})`)
check(n?.meta === 'Checked by Opus · ~$0.02', `the meta names the check and its cost (${n?.meta})`)
check(!n?.action, 'no "Open chat" for the chat already in focus')
check(pet.said.length === 0, 'no pet on screen -> nothing is said')
const shown = stub.calls.notify.length
await emit('rt-1', { status: 'complete', text: long('one') })
check(rest.length === 1 && stub.calls.notify.length === shown, 'the same reply is checked once')
check(mod.replyKey(long('one')) !== mod.replyKey(long('onf')) && mod.replyKey('ab') !== mod.replyKey('ba'), 'a reply differing only at its end is a different reply')

// 4. a reply in another chat the user opened earlier
// The app sets the stored atom first here: the pair is read once both have settled.
stub.host.state.focusedStoredSessionId.set('st-2')
stub.host.state.focusedSessionId.set('rt-2')
await settle()
pet.visible = true
reply = { points: [{ kind: 'irreversible', text: 'The script deletes the old backups.' }], cost_usd: 0.004, cost_status: 'estimated' }
await emit('rt-1', { status: 'complete', text: long('two') })
n = stub.calls.notify.at(-1)
check(n?.message === 'Cannot be undone: The script deletes the old backups.' && n?.detail === undefined && n?.meta === 'Checked by Opus · <$0.01',
  `one point, no detail, a sub-cent cost (${n?.message} | ${n?.meta})`)
check(n?.action?.label === 'Open chat', 'a reply in a chat not in focus offers "Open chat"')
n?.action?.onClick()
await settle()
check(stub.calls.opened.at(-1) === 'st-1', `"Open chat" opens the reply's own chat (${stub.calls.opened.at(-1)})`)
check(pet.said.length === 1 && pet.said[0][0] === 'You should know: 1 point in the notice', `with a pet on screen it points to the notice (${JSON.stringify(pet.said)})`)
check(n?.id !== stub.calls.notify[shown - 1]?.id, 'each reply gets its own notice')

// 5. nothing to flag; a failed check
const before = stub.calls.notify.length
reply = { points: [], cost_usd: 0.02, cost_status: 'estimated' }
await emit('rt-2', { status: 'complete', text: long('three') })
check(rest.length === 3 && stub.calls.notify.length === before, 'nothing to flag -> no notice')
restFails = 'model call failed (APITimeoutError)'
const warn = console.warn
console.warn = () => {}
await emit('rt-2', { status: 'complete', text: long('four') })
console.warn = warn
n = stub.calls.notify.at(-1)
check(n?.kind === 'error' && n?.id === 'you-should-know-error' && n?.message === 'Could not check a long reply: model call failed (APITimeoutError)',
  `a failed check is one error notice that names the error (${n?.message})`)
restFails = null
check(mod.fmtCost(null, 'unknown') === '' && mod.fmtCost(0.7, 'unknown') === '' && mod.fmtCost(0, 'included') === 'subscription' && mod.fmtCost(0.38, 'actual') === '$0.38',
  'cost text: unpriced is empty even with an amount stored, subscription named, billed as is')
check(mod.noticeFor({ points: [], cost_usd: 1, cost_status: 'estimated' }, { key: 'k' }) === null, 'no points -> no notice')
reply = { points: [{ kind: 'security', text: 'The token is in the log.' }], cost_usd: null, cost_status: 'unknown' }
await emit('rt-2', { status: 'complete', text: long('five') })
check(stub.calls.notify.at(-1)?.meta === 'Checked by Opus', `an unpriced check names no cost, never $0 (${stub.calls.notify.at(-1)?.meta})`)

// 7. every key the source asks for resolves
const keys = [...source.matchAll(/\bt\('([a-z.]+)'/g)].map(m => m[1])
const raw = keys.filter(k => mod.t(k, 1, 'x') === k)
check(keys.length >= 5 && raw.length === 0, `every t() key resolves (${keys.length} keys${raw.length ? `, raw: ${raw}` : ''})`)
for (const kind of ['cost', 'irreversible', 'security', 'action', 'assumption', 'deadline']) {
  if (mod.t(`ysk.kind.${kind}`) === `ysk.kind.${kind}`) check(false, `kind ${kind} has a label`)
}

// 1. dispose
disposers.forEach(fn => fn())
check(stub.host.state.focusedSessionId.subs.size === 0 && stub.host.state.focusedStoredSessionId.subs.size === 0, 'dispose retires the focus listeners')

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
process.exitCode = failures ? 1 : 0
