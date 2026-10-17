/**
 * Asterisk — the desktop half, driven like the app drives it: real React in jsdom, the SDK
 * replaced by a stub, the two contributions mounted the way the host mounts them (the composer.top
 * render as a component; each sidebar row through render({ sessionId }) inside a component).
 *
 * Run: npm ci      (once, in tests/: React and jsdom pinned to the core desktop app's versions)
 *      node render_check.mjs [path/to/plugin.js]      (exit 0 = passed)
 * React and jsdom come from tests/node_modules, or from ASTERISK_NODE_MODULES (the canary sets it).
 *
 * Locks:
 *   1. Registration: exactly two contributions, `composer.top` (render) and `sessionRow.trailing`
 *      (data.render); no pane, no page, no nav row, revealPane never called; the English bundle;
 *      one message.complete listener; focus listeners are retired on dispose.
 *   2. Which replies: status complete, not a reused reply, a string of at least 3000 characters,
 *      in a chat the user has opened in this app. A subagent mirror (no status), an error, a short
 *      reply or a chat never opened is never sent.
 *   3. Once per reply: the same text again is not checked twice; a reply differing only at its end
 *      is a different reply (the key covers the whole text).
 *   4. The request: POST /check with exactly { session_id, turn } — the stored id of the reply's OWN
 *      chat (even when another chat is in focus) and the frame's persisted_turn receipt as is; never
 *      the reply's text. A frame without a receipt still posts, with turn: null (the backend's
 *      refusal becomes the error notice, never a silent skip).
 *   5. The strip: nothing when no note is pending; a point is a note, never a toast. One note: the
 *      label "Worth knowing", no number, headline, sentence, meta "Opus · <cost> · decided by ...",
 *      "Already knew" and "Got it" ("Open" only for another chat). Several notes: "Worth knowing ·
 *      N notes", numbered 1..N in arrival order; the focused chat's note expanded, the others one
 *      line "<title> · Opus <cost>" ("Untitled chat" without a title) with "Open".
 *   6. Buttons: "Open" opens that note's own chat and keeps the note (it expands once that chat is
 *      focused); "Got it" removes only that note and posts nothing; "Already knew" removes it and
 *      posts /feedback { check_at } with that check's `at`; a failed /feedback is one named error
 *      toast; the last note gone, the strip is gone.
 *   7. Sidebar dot: one dot, labelled, on each row whose chat has a pending note; nothing on other
 *      rows; a chat's last note dismissed, its dot goes.
 *   8. Motion: reduced motion -> data-motion="reduce" and no inline animation-delay anywhere;
 *      otherwise "full" and an 80 ms stagger; in the CSS the stroke is drawn (dash offset 0) under
 *      reduce and every animation is keyed on [data-motion="full"].
 *   9. No asterisk: plugin.js has none of the asterisk-like glyphs, and no rendered text, aria-label
 *      or title has `*` or any of them.
 *  10. Errors and pet: a point without a headline is one error toast and no note; a failed check is
 *      one error toast that names the error; with a pet on screen it points to the strip.
 *  11. Copy and theme: every t() key resolves (no raw key on screen); the strip's CSS names only
 *      var(--ui-...) and var(--font-...) tokens and no literal colour. React logs no warning.
 *  12. Focus: the app sets the two focus atoms in either order; a chat is never filed under the
 *      other chat's stored id.
 *  13. Status and old cores: (a) registration posts /status { desktop_ready: true } once; (b) an
 *      answer with ready: false stops later /check posts and shows one asterisk-update-hermes warning
 *      only when update_notice is true; (c) old_install: true stops later /check posts and shows one
 *      asterisk-old-install warning with its copy; (d) ready: true without old_install, or a failed or
 *      malformed /status, keeps posting as today with no status toast; (e) the same plugin.js against
 *      an SDK without SESSION_ROW_AREAS (or without COMPOSER_AREAS) imports, and register does not
 *      throw, registers nothing, adds no listener, posts /status { desktop_ready: false } once and
 *      shows the update warning only when the answer says update_notice: true.
 *  REST counts in locks 1-12 count /check and /feedback calls only.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = process.argv[2] ? path.resolve(process.argv[2]) : path.join(HERE, '..', 'desktop', 'plugin.js')
const OUT = path.join(HERE, '.out', process.env.ASTERISK_RENDER_OUT || 'main')
const NM = process.env.ASTERISK_NODE_MODULES ? path.resolve(process.env.ASTERISK_NODE_MODULES) : path.join(HERE, 'node_modules')
if (!['react', 'react-dom', 'jsdom'].every(p => existsSync(path.join(NM, p, 'package.json')))) {
  console.log(`FAIL  React, react-dom or jsdom missing in ${NM} — run \`npm ci\` in tests/ first`)
  process.exit(1)
}
const ANCHOR = path.join(NM, '..', 'package.json') // resolves from NM, wherever this copy runs
const require = createRequire(ANCHOR)
mkdirSync(OUT, { recursive: true })

// ── a DOM before React loads ─────────────────────────────────────────────────
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
let reduce = false
dom.window.matchMedia = query => ({ matches: query.includes('reduce') && reduce, media: query, addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {} })
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, k, { value: k === 'window' ? dom.window : dom.window[k], configurable: true, writable: true })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act, createElement } = React

const anchor = JSON.stringify(ANCHOR)
writeFileSync(path.join(OUT, 'react-jsx.mjs'), `import { createRequire } from 'node:module'
const m = createRequire(${anchor})('react/jsx-runtime')
export const jsx = m.jsx, jsxs = m.jsxs, Fragment = m.Fragment
`)
// The SDK stub; an old core's SDK is the same without SESSION_ROW_AREAS or COMPOSER_AREAS.
const stubSource = ({ composer = true, rows = true } = {}) => `import { createRequire } from 'node:module'
const React = createRequire(${anchor})('react')
// listen: the plugin's own subscriptions (counted by the locks); views: the hooks' (useValue).
export function atom(v) {
  const subs = new Set(), views = new Set()
  return { get: () => v, set: n => { v = n; subs.forEach(f => f(v)); views.forEach(f => f()) }, listen: f => { subs.add(f); return () => subs.delete(f) },
           view: f => { views.add(f); return () => views.delete(f) }, subs, views }
}
export const useValue = a => React.useSyncExternalStore(a.view, a.get)
export const i18n = { bundle: null, ids: new Set() }
export function usePluginI18n(id) {
  i18n.ids.add(id)
  return (key, ...args) => {
    let node = i18n.bundle?.en
    for (const part of key.split('.')) node = node?.[part]
    return typeof node === 'function' ? node(...args) : typeof node === 'string' ? node : key
  }
}
${composer ? "export const COMPOSER_AREAS = { top: 'composer.top', bottom: 'composer.bottom' }" : ''}
${rows ? "export const SESSION_ROW_AREAS = { leading: 'sessionRow.leading', trailing: 'sessionRow.trailing' }" : ''}
export const calls = { notify: [], opened: [], revealPane: [] }
export const host = {
  state: { focusedSessionId: atom('rt-1'), focusedStoredSessionId: atom('st-1') },
  notify: n => { calls.notify.push(n) },
  openSession: async sid => { calls.opened.push(sid) },
  revealPane: (...a) => { calls.revealPane.push(a) }
}
`
const source = readFileSync(SRC, 'utf8')
const href = f => `'${pathToFileURL(path.join(OUT, f)).href}'`
/** plugin.js against a given stub, as a module file; every SDK import specifier is pointed at the stub. */
const variant = (stubFile, pluginFile, opts) => {
  writeFileSync(path.join(OUT, stubFile), stubSource(opts))
  writeFileSync(path.join(OUT, pluginFile),
    source.replaceAll("'@hermes/plugin-sdk'", href(stubFile)).replace("'react/jsx-runtime'", href('react-jsx.mjs')))
}
variant('sdk-stub.mjs', 'plugin-under-test.mjs')
const stub = await import(pathToFileURL(path.join(OUT, 'sdk-stub.mjs')).href)
const mod = await import(pathToFileURL(path.join(OUT, 'plugin-under-test.mjs')).href)

let failures = 0
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`)
  if (!ok) failures++
}
const settle = () => new Promise(r => setTimeout(r, 0))
const reactWarnings = []
const consoleError = console.error
console.error = (...a) => { reactWarnings.push(a.map(String).join(' ')) }

// ── fake ctx ────────────────────────────────────────────────────────────────
const registered = []
const listeners = new Map()
const disposers = []
const rest = [] // /check and /feedback calls; /status goes to statusCalls
const statusCalls = []
let reply = { points: [], cost_usd: 0.0213, cost_status: 'estimated', at: 1, title: null }
let restFails = null
const pet = { visible: false, said: [] }
const ctx = {
  register: c => { registered.push(c); return () => {} },
  i18n: { register: b => { ctx.bundle = b; stub.i18n.bundle = b } },
  onEvent: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type).delete(fn) },
  onDispose: fn => { disposers.push(fn) },
  rest: async (p, opts) => {
    if (p === '/status') {
      statusCalls.push(opts)
      return { ready: true, update_notice: false, old_install: false }
    }
    rest.push([p, opts])
    if (restFails) throw new Error(restFails)
    return reply
  },
  pet: { visible: { get: () => pet.visible }, say: (text, opts) => { pet.said.push([text, opts]) } }
}
const emit = (session_id, payload) => act(async () => {
  for (const fn of listeners.get('message.complete') || []) fn({ type: 'message.complete', session_id, payload })
  await settle()
  await settle()
})
const LONG = 'A'.repeat(2990) + ' — the end of a long reply.'
const long = tag => `${LONG} ${tag}`
// The frame's receipt, as tui_gateway's _persisted_turn_receipt sends it.
const receipt = base => ({ row_ids: [base, base + 1, base + 2], complete: true, user_row_id: base, final_assistant_row_id: base + 2 })
const frame = (tag, base) => ({ status: 'complete', text: long(tag), persisted_turn: receipt(base) })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const point = (headline, text, by = 'assistant', kind = 'tradeoff') => ({ kind, by, headline, text })
const focus = (runtime, stored) => act(async () => {
  stub.host.state.focusedSessionId.set(runtime)
  stub.host.state.focusedStoredSessionId.set(stored)
  await settle()
})

// ── the host's mounts ───────────────────────────────────────────────────────
const mount = element => {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  act(() => root.render(element))
  return { el, root, rerender: next => act(() => root.render(next)) }
}
const $ = (el, sel) => el.querySelector(sel)
const $$ = (el, sel) => [...el.querySelectorAll(sel)]
const text = el => (el?.textContent ?? '').trim()
const click = el => act(async () => { el.click(); await settle() })
const buttons = el => $$(el, 'button').map(b => text(b))
const button = (el, label) => $$(el, 'button').find(b => text(b) === label)

// 1. registration
mod.default.register(ctx)
await settle()
const areas = registered.map(c => c.area)
check(registered.length === 2 && same(areas, ['composer.top', 'sessionRow.trailing']),
  `exactly two contributions: composer.top and sessionRow.trailing (${JSON.stringify(areas)})`)
const stripC = registered.find(c => c.area === 'composer.top')
const dotC = registered.find(c => c.area === 'sessionRow.trailing')
check(typeof stripC?.render === 'function' && typeof dotC?.data?.render === 'function' && !registered.some(c => /pane|settings|nav/i.test(String(c.area))),
  'composer.top has a render, sessionRow.trailing a data.render; no pane, page or nav row')
check(ctx.bundle?.en?.asterisk?.title === 'Asterisk' && ctx.bundle?.en?.asterisk?.label === 'Worth knowing', 'the English bundle is registered')
check(listeners.get('message.complete')?.size === 1 && listeners.size === 1, 'one listener, on message.complete only')
check(stub.host.state.focusedSessionId.subs.size === 1 && stub.host.state.focusedStoredSessionId.subs.size === 1, 'focus is followed')
check(statusCalls.length === 1 && same(statusCalls[0], { method: 'POST', body: { desktop_ready: true } }) && stub.calls.notify.length === 0,
  `13a. registration posts /status { desktop_ready: true } once; ready, no old install -> no notice (${JSON.stringify(statusCalls)})`)

const strip = mount(createElement(stripC.render))
const ROWS = ['st-1', 'st-2', 'st-3', 'st-4', 'st-5']
function Row({ sessionId }) {
  return dotC.data.render({ sessionId })
}
const rows = Object.fromEntries(ROWS.map(id => [id, mount(createElement(Row, { sessionId: id }))]))
const dots = () => Object.fromEntries(ROWS.map(id => [id, $$(rows[id].el, '[data-asterisk="dot"]').length]))
check(strip.el.innerHTML === '' && ROWS.every(id => rows[id].el.innerHTML === ''), 'with no notes the strip renders nothing and no row has a dot')
check(stub.i18n.ids.has('asterisk'), 'React copy comes from usePluginI18n(\'asterisk\')')

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

// 3/4/5. one note, in the focused chat
const H1 = 'SQLite chosen over Postgres'
reply = { points: [point(H1, 'The assistant chose SQLite over Postgres without saying it drops concurrent writes.')],
  cost_usd: 0.0213, cost_status: 'estimated', at: 1000.5, title: 'Deploy plan' }
await emit('rt-1', frame('one', 10))
const body1 = rest[0]?.[1]?.body
check(rest.length === 1 && rest[0][0] === '/check' && rest[0][1]?.method === 'POST', 'a long reply of the focused chat is sent to POST /check')
check(same(Object.keys(body1 || {}).sort(), ['session_id', 'turn']) && body1.session_id === 'st-1' && same(body1.turn, receipt(10)),
  `the body is { session_id, turn }: the chat's stored id and the frame's receipt as is (${JSON.stringify(body1)})`)
check(!('text' in (body1 || {})) && !JSON.stringify(body1).includes(LONG.slice(0, 50)), 'the reply\'s text is not sent')
check(stub.calls.notify.length === 0, `a point is a note, not a toast (${stub.calls.notify.length} notify calls)`)
let s = $(strip.el, '[data-asterisk="strip"]')
check(s?.getAttribute('data-count') === '1' && s?.getAttribute('role') === 'region' && s?.getAttribute('aria-label') === 'Worth knowing'
  && s?.getAttribute('aria-live') === 'polite', `one strip, data-count 1, a labelled live region (${s?.outerHTML.slice(0, 160)})`)
check(text($(s, '[data-asterisk="label"]')) === 'Worth knowing', `the label is exactly "Worth knowing" (${text($(s, '[data-asterisk="label"]'))})`)
let entries = $$(strip.el, '[data-asterisk="entry"]')
check(entries.length === 1 && $(s, 'ol') && entries[0].parentElement.tagName === 'OL' && $$(s, '[data-asterisk="num"]').length === 0,
  'one entry in an ordered list, no number for a single note')
check(text($(entries[0], '[data-asterisk="headline"]')) === H1 && text($(entries[0], '[data-asterisk="text"]')).startsWith('The assistant chose SQLite'),
  'the entry shows the headline and the sentence')
const stroke = $(entries[0], '[data-asterisk="stroke"]')
check(stroke?.getAttribute('aria-hidden') === 'true' && stroke?.getAttribute('viewBox') === '0 0 200 8' && stroke?.getAttribute('preserveAspectRatio') === 'none'
  && stroke?.querySelector('path')?.getAttribute('d') === 'M2 5 C 40 2, 80 7, 120 4 S 180 3, 198 5', 'the headline is underlined by the hidden SVG stroke')
check(text($(entries[0], '[data-asterisk="meta"]')) === 'Opus · ~$0.02 · decided by assistant', `meta: Opus, the cost, who decided (${text($(entries[0], '[data-asterisk="meta"]'))})`)
check(same(buttons(strip.el), ['Already knew', 'Got it']) && $$(strip.el, 'button').every(b => b.getAttribute('type') === 'button'),
  `the focused chat's note offers "Already knew" and "Got it", no "Open" (${buttons(strip.el)})`)
check(pet.said.length === 0, 'no pet on screen -> nothing is said')
const texts = []
const collect = el => {
  texts.push(el.textContent)
  for (const e of $$(el, '*')) for (const a of ['aria-label', 'title']) if (e.getAttribute(a)) texts.push(e.getAttribute(a))
}
collect(strip.el)
check(same(dots(), { 'st-1': 1, 'st-2': 0, 'st-3': 0, 'st-4': 0, 'st-5': 0 }), `the note's chat has a dot, the other rows nothing (${JSON.stringify(dots())})`)
await emit('rt-1', frame('one', 10))
check(rest.length === 1 && $$(strip.el, '[data-asterisk="entry"]').length === 1, 'the same reply is checked once')
check(mod.replyKey(long('one')) !== mod.replyKey(long('onf')) && mod.replyKey('ab') !== mod.replyKey('ba'), 'a reply differing only at its end is a different reply')

// 4/5. two more chats: the app sets the focus atoms in either order; a reply in a chat not in focus
await act(async () => {
  stub.host.state.focusedStoredSessionId.set('st-2')
  stub.host.state.focusedSessionId.set('rt-2')
  await settle()
})
reply = { points: [], cost_usd: 0.01, cost_status: 'estimated', at: 1500, title: null }
await emit('rt-1', frame('back', 15))
check(rest.at(-1)?.[1]?.body?.session_id === 'st-1',
  `the stored atom set before the runtime one does not file the old chat under the new id (${rest.at(-1)?.[1]?.body?.session_id})`)
await focus('rt-3', 'st-3')
pet.visible = true
reply = { points: [point('Old backups deleted', 'You asked to delete the old backups; the reply calls it a cleanup.', 'user', 'irreversible')],
  cost_usd: 0.004, cost_status: 'estimated', at: 2000.25, title: null }
await emit('rt-2', frame('two', 20))
const body2 = rest.at(-1)?.[1]?.body
check(body2?.session_id === 'st-2' && same(body2?.turn, receipt(20)),
  `a reply finishing in a chat not in focus sends THAT chat's stored id, not the focused one (${body2?.session_id})`)
check(pet.said.length === 1 && pet.said[0][0] === 'Worth knowing: a note above the input' && pet.said[0][1]?.tone === 'info',
  `with a pet on screen it points to the strip (${JSON.stringify(pet.said)})`)
reply = { points: [point('Release tag pushed', 'The assistant pushed the release tag before the tests finished.')],
  cost_usd: 0.0412, cost_status: 'estimated', at: 3000.75, title: 'Release notes' }
await emit('rt-3', frame('three', 30))
s = $(strip.el, '[data-asterisk="strip"]')
entries = $$(strip.el, '[data-asterisk="entry"]')
check(s?.getAttribute('data-count') === '3' && text($(s, '[data-asterisk="label"]')) === 'Worth knowing · 3 notes',
  `three notes: data-count 3, label "Worth knowing · 3 notes" (${text($(s, '[data-asterisk="label"]'))})`)
check(same($$(s, '[data-asterisk="num"]').map(text), ['1', '2', '3']) && same(entries.map(e => text($(e, '[data-asterisk="headline"]'))), [H1, 'Old backups deleted', 'Release tag pushed']),
  'numbered 1, 2, 3 in arrival order')
check(entries[2].getAttribute('data-expanded') === 'true' && text($(entries[2], '[data-asterisk="text"]')).startsWith('The assistant pushed')
  && text($(entries[2], '[data-asterisk="meta"]')) === 'Opus · ~$0.04 · decided by assistant' && same(buttons(entries[2]), ['Already knew', 'Got it']),
  `the focused chat's note is expanded (${text($(entries[2], '[data-asterisk="meta"]'))})`)
check(entries[0].getAttribute('data-expanded') === 'false' && !$(entries[0], '[data-asterisk="text"]') && text($(entries[0], '[data-asterisk="meta"]')) === 'Deploy plan · Opus ~$0.02'
  && same(buttons(entries[0]), ['Open']), `another chat's note is one line "<title> · Opus <cost>" and "Open" (${text($(entries[0], '[data-asterisk="meta"]'))})`)
check(text($(entries[1], '[data-asterisk="meta"]')) === 'Untitled chat · Opus <$0.01' && same(buttons(entries[1]), ['Open']),
  `a note without a title shows "Untitled chat" (${text($(entries[1], '[data-asterisk="meta"]'))})`)
check(same(dots(), { 'st-1': 1, 'st-2': 1, 'st-3': 1, 'st-4': 0, 'st-5': 0 }) && $$(rows['st-2'].el, '[data-asterisk="dot"]')[0]?.getAttribute('aria-label') === 'Worth knowing: a note waiting'
  && $$(rows['st-2'].el, '[data-asterisk="dot"]')[0]?.getAttribute('title') === 'Worth knowing: a note waiting',
  `one labelled dot on each chat with a pending note, nothing on the others (${JSON.stringify(dots())})`)
collect(strip.el)
ROWS.forEach(id => collect(rows[id].el))

// 8. motion
check(s?.getAttribute('data-motion') === 'full' && same(entries.map(e => e.style.animationDelay), ['0ms', '80ms', '160ms']),
  `no reduced motion: data-motion "full", entries staggered 0/80/160 ms (${entries.map(e => e.style.animationDelay)})`)
reduce = true
strip.rerender(createElement(stripC.render))
s = $(strip.el, '[data-asterisk="strip"]')
check(s?.getAttribute('data-motion') === 'reduce' && !$$(strip.el, '*').some(e => e.style?.animationDelay || /animation-delay/i.test(e.getAttribute('style') || '')),
  'reduced motion: data-motion "reduce" and no inline animation-delay on any element')
const css = text($(strip.el, 'style'))
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }))
check(rules.some(r => r.sel.includes('[data-motion="reduce"]') && r.sel.includes('stroke') && /stroke-dashoffset:\s*0\b/.test(r.body)),
  'the CSS shows the stroke fully drawn (dash offset 0) under [data-motion="reduce"]')
const animated = rules.filter(r => /(^|;)\s*animation\s*:/.test(r.body))
check(animated.length >= 2 && animated.every(r => r.sel.includes('[data-motion="full"]')), `every animation is keyed on [data-motion="full"] (${animated.map(r => r.sel)})`)
check(rules.some(r => r.sel.includes('[data-motion="full"]') && /stroke-dashoffset:\s*400/.test(r.body) && /animation:\s*asterisk-draw 1\.1s \.3s/.test(r.body)),
  'under full motion the stroke draws from dash offset 400 (1.1s, .3s delay)')
reduce = false
strip.rerender(createElement(stripC.render))

// 6. Open, then focus moves to that chat
await click(button(entries[0], 'Open'))
check(stub.calls.opened.at(-1) === 'st-1' && $$(strip.el, '[data-asterisk="entry"]').length === 3,
  `"Open" opens that note's own chat, not the focused one, and keeps the note (${stub.calls.opened.at(-1)})`)
await focus('rt-1', 'st-1')
entries = $$(strip.el, '[data-asterisk="entry"]')
check(entries[0].getAttribute('data-expanded') === 'true' && entries[2].getAttribute('data-expanded') === 'false'
  && text($(entries[2], '[data-asterisk="meta"]')) === 'Release notes · Opus ~$0.04', 'once that chat is focused its note is expanded, the others collapse')

// 6. Got it
let posts = rest.length
await click(button(entries[0], 'Got it'))
entries = $$(strip.el, '[data-asterisk="entry"]')
check(entries.length === 2 && same($$(strip.el, '[data-asterisk="num"]').map(text), ['1', '2']) && rest.length === posts
  && same(entries.map(e => text($(e, '[data-asterisk="headline"]'))), ['Old backups deleted', 'Release tag pushed']),
  '"Got it" removes only that note (3 -> 2, renumbered 1, 2) and posts nothing')
check(same(dots(), { 'st-1': 0, 'st-2': 1, 'st-3': 1, 'st-4': 0, 'st-5': 0 }), `a chat's last note dismissed, its dot goes (${JSON.stringify(dots())})`)

// 6. Already knew
await focus('rt-2', 'st-2')
entries = $$(strip.el, '[data-asterisk="entry"]')
await click(button(entries[0], 'Already knew'))
check(rest.length === posts + 1 && rest.at(-1)[0] === '/feedback' && rest.at(-1)[1]?.method === 'POST' && same(rest.at(-1)[1]?.body, { check_at: 2000.25 })
  && $$(strip.el, '[data-asterisk="entry"]').length === 1, `"Already knew" removes the note and posts /feedback { check_at } with its check's at (${JSON.stringify(rest.at(-1))})`)
entries = $$(strip.el, '[data-asterisk="entry"]')
check(text($(strip.el, '[data-asterisk="label"]')) === 'Worth knowing' && $$(strip.el, '[data-asterisk="num"]').length === 0
  && text($(entries[0], '[data-asterisk="meta"]')) === 'Release notes · Opus · ~$0.04 · decided by assistant' && same(buttons(entries[0]), ['Already knew', 'Open', 'Got it']),
  `a single note of another chat is expanded, names its chat and offers "Open" (${text($(entries[0], '[data-asterisk="meta"]'))} | ${buttons(entries[0])})`)
collect(strip.el)
restFails = 'network down'
const warn = console.warn
console.warn = () => {}
await click(button(entries[0], 'Already knew'))
let n = stub.calls.notify.at(-1)
check(stub.calls.notify.length === 1 && n?.id === 'asterisk-feedback-error' && n?.kind === 'error' && n?.title === 'Asterisk'
  && n?.message === 'Could not record "Already knew": network down', `a failed /feedback is one named error toast (${JSON.stringify(n)})`)
check(strip.el.innerHTML === '' && ROWS.every(id => rows[id].el.innerHTML === ''), 'the last note removed, the strip and every dot are gone')

// 10. errors
const toasts = stub.calls.notify.length
restFails = null
reply = { points: [{ kind: 'cost', by: 'user', text: 'No headline here.' }], cost_usd: 0.02, cost_status: 'estimated', at: 4000, title: 'X' }
await emit('rt-3', frame('four', 40))
n = stub.calls.notify.at(-1)
check(stub.calls.notify.length === toasts + 1 && n?.id === 'asterisk-error' && n?.message === 'Could not check a long reply: the answer has no headline'
  && strip.el.innerHTML === '', `a point without a headline is one error toast and no note (${n?.message})`)
reply = { points: [], cost_usd: 0.02, cost_status: 'estimated', at: 4001, title: null }
await emit('rt-3', frame('five', 50))
check(strip.el.innerHTML === '' && stub.calls.notify.length === toasts + 1, 'nothing to flag -> no note, no toast')
restFails = 'model call failed (APITimeoutError)'
await emit('rt-3', frame('six', 60))
n = stub.calls.notify.at(-1)
check(n?.kind === 'error' && n?.id === 'asterisk-error' && n?.message === 'Could not check a long reply: model call failed (APITimeoutError)',
  `a failed check is one error toast that names the error (${n?.message})`)
// 4. a frame without a receipt (a core before persisted_turn) still posts; the refusal is the error toast
restFails = 'turn ids missing or malformed'
await emit('rt-3', { status: 'complete', text: long('no receipt') })
console.warn = warn
const body3 = rest.at(-1)?.[1]?.body
check(body3?.session_id === 'st-3' && 'turn' in body3 && body3.turn === null, `a frame without a receipt still posts, with turn: null (${JSON.stringify(body3)})`)
n = stub.calls.notify.at(-1)
check(n?.kind === 'error' && n?.message === 'Could not check a long reply: turn ids missing or malformed', `the refusal is the error toast, never a silent skip (${n?.message})`)
restFails = null
check(mod.fmtCost(null, 'unknown') === '' && mod.fmtCost(0.7, 'unknown') === '' && mod.fmtCost(0, 'included') === 'subscription' && mod.fmtCost(0.38, 'actual') === '$0.38',
  'cost text: unpriced is empty even with an amount stored, subscription named, billed as is')
const unpriced = mod.noteFor({ points: [point('H', 'T')], cost_usd: null, cost_status: 'unknown', at: 5 }, { key: 'k', storedId: 'st-9' })
check(unpriced?.cost === '' && mod.t('asterisk.meta', '', 'decided by you', '') === 'Opus · decided by you' && mod.t('asterisk.from', 'Chat', '') === 'Chat · Opus',
  'an unpriced check names no cost, never $0')
check(mod.noteFor({ points: [], at: 1 }, { key: 'k' }) === null && same(Object.keys(unpriced).sort(), ['by', 'checkAt', 'cost', 'headline', 'id', 'storedId', 'text', 'title']),
  'no points -> no note; a note is { id, storedId, title, headline, text, by, cost, checkAt }')

// 9. no asterisk
const GLYPHS = /[\u2042\u204E\u2051\u2217\u2722-\u2727\u2731-\u273D\u2749-\u274B\uFE61\uFF0A]/u
check(!GLYPHS.test(source), 'plugin.js contains no asterisk-like glyph')
const starred = texts.filter(x => x.includes('*') || GLYPHS.test(x))
check(texts.length > 10 && starred.length === 0, `no rendered text, aria-label or title has an asterisk (${texts.length} strings${starred.length ? `: ${starred}` : ''})`)

// 11. copy and theme
const keys = [...source.matchAll(/\bt\('([a-zA-Z.]+)'/g)].map(m => m[1])
const raw = keys.filter(k => mod.t(k, 1, 'x', 'y') === k)
check(keys.length >= 12 && raw.length === 0, `every t() key resolves (${keys.length} keys${raw.length ? `, raw: ${raw}` : ''})`)
check(mod.t('asterisk.kind.tradeoff') === 'asterisk.kind.tradeoff' && mod.t('asterisk.point') === 'asterisk.point', 'the kind labels and the toast line are retired')
const vars = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1])
check(vars.length > 5 && vars.every(v => v.startsWith('--ui-') || v.startsWith('--font-')), `the strip's CSS names only --ui-* and --font-* tokens (${[...new Set(vars)]})`)
const literal = css.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(|:\s*(?:white|black)\b/i)
check(!literal, `the strip's CSS has no literal colour (${literal?.[0] ?? 'none'})`)
check(stub.calls.revealPane.length === 0, 'host.revealPane is never called')
check(reactWarnings.length === 0, `React logged no warning (${reactWarnings.slice(0, 2).join(' | ')})`)

// 13. status: one more registration per /status answer, on the same app, disposed afterwards
function fakeCtx(answer) {
  const c = { registered: [], listeners: new Set(), disposers: [], status: [], checks: [], i18n: 0 }
  c.ctx = {
    register: x => { c.registered.push(x); return () => {} },
    i18n: { register: () => { c.i18n++ } },
    onEvent: (type, fn) => { c.listeners.add(fn); return () => c.listeners.delete(fn) },
    onDispose: fn => { c.disposers.push(fn) },
    rest: async (p, opts) => {
      if (p === '/status') {
        c.status.push(opts)
        if (answer instanceof Error) throw answer
        return answer
      }
      c.checks.push([p, opts])
      return { points: [], cost_usd: 0.01, cost_status: 'estimated', at: 9, title: null }
    }
  }
  return c
}
const quietly = async fn => {
  const w = console.warn
  console.warn = () => {}
  try { await fn() } finally { console.warn = w }
}
let tag = 0
/** Registers against the answer, then a long reply of the focused chat finishes; returns the ctx and the new toasts. */
async function statusRun(answer) {
  const c = fakeCtx(answer)
  const before = stub.calls.notify.length
  await quietly(async () => {
    mod.default.register(c.ctx)
    await settle()
    await settle()
    const sid = stub.host.state.focusedSessionId.get()
    for (const fn of c.listeners) fn({ type: 'message.complete', session_id: sid, payload: frame(`status ${++tag}`, 100 + tag * 10) })
    await settle()
    await settle()
  })
  c.disposers.forEach(fn => fn())
  return { c, toasts: stub.calls.notify.slice(before) }
}
const UPDATE = 'Asterisk needs Hermes v0.21.6 or later and stays off until then. Update Hermes, then reopen the app.'
const OLD = 'The old "you-should-know" plugin is still installed, so Asterisk stays off and no reply is checked twice. Uninstall it in Capabilities → Plugins, then reopen the app.'
const updateToast = list => list.length === 1 && list[0].id === 'asterisk-update-hermes' && list[0].kind === 'warning' && list[0].title === 'Asterisk' && list[0].message === UPDATE
let run = await statusRun({ ready: false, update_notice: true, old_install: false })
check(run.c.checks.length === 0 && updateToast(run.toasts),
  `13b. ready: false -> no later /check post; update_notice: true -> one asterisk-update-hermes warning (${run.c.checks.length} posts, ${JSON.stringify(run.toasts)})`)
run = await statusRun({ ready: false, update_notice: false, old_install: false })
check(run.c.checks.length === 0 && run.toasts.length === 0, `13b. ready: false without update_notice -> no post and no notice (${JSON.stringify(run.toasts)})`)
run = await statusRun({ ready: true, update_notice: false, old_install: true })
check(run.c.checks.length === 0 && run.toasts.length === 1 && run.toasts[0].id === 'asterisk-old-install' && run.toasts[0].kind === 'warning'
  && run.toasts[0].title === 'Asterisk' && run.toasts[0].message === OLD,
  `13c. old_install: true -> no later /check post, one asterisk-old-install warning with its copy (${run.c.checks.length} posts, ${JSON.stringify(run.toasts)})`)
run = await statusRun({ ready: true, update_notice: false, old_install: false })
check(run.c.checks.length === 1 && run.c.checks[0][0] === '/check' && run.toasts.length === 0,
  `13d. ready: true, old_install: false -> the reply is posted as today, no status toast (${run.c.checks.length} posts, ${run.toasts.length} toasts)`)
for (const [name, answer] of [['a failed /status', new Error('network down')], ['a malformed /status', { ready: 'yes' }], ['an empty /status', null]]) {
  run = await statusRun(answer)
  check(run.c.checks.length === 1 && run.toasts.length === 0 && run.c.status.length === 1,
    `13d. ${name} changes nothing: the reply is posted, no toast (${run.c.checks.length} posts, ${run.toasts.length} toasts)`)
}

// 13e. an old core's SDK: the same plugin.js against a stub without one of the area names
for (const [name, opts] of [['SESSION_ROW_AREAS', { rows: false }], ['COMPOSER_AREAS', { composer: false }]]) {
  const key = name.toLowerCase().replace('_', '-')
  variant(`sdk-old-${key}.mjs`, `plugin-old-${key}.mjs`, opts)
  let oldStub, oldMod, err = null
  try {
    oldStub = await import(pathToFileURL(path.join(OUT, `sdk-old-${key}.mjs`)).href)
    oldMod = await import(pathToFileURL(path.join(OUT, `plugin-old-${key}.mjs`)).href)
  } catch (e) {
    err = e
  }
  check(!err, `13e. without ${name} plugin.js still imports (${err?.message ?? 'linked'})`)
  if (err) continue
  for (const notice of [true, false]) {
    const c = fakeCtx({ ready: false, update_notice: notice, old_install: false })
    const before = oldStub.calls.notify.length
    let threw = null
    await quietly(async () => {
      try {
        oldMod.default.register(c.ctx)
      } catch (e) {
        threw = e
      }
      await settle()
      await settle()
    })
    const toasts = oldStub.calls.notify.slice(before)
    const subs = oldStub.host.state.focusedSessionId.subs.size + oldStub.host.state.focusedStoredSessionId.subs.size
    check(!threw && c.registered.length === 0 && c.listeners.size === 0 && c.i18n === 0 && subs === 0
      && same(c.status, [{ method: 'POST', body: { desktop_ready: false } }]) && (notice ? updateToast(toasts) : toasts.length === 0),
      `13e. without ${name}, update_notice ${notice}: register does not throw, registers nothing, adds no listener, posts /status { desktop_ready: false } once, ${notice ? 'one update warning' : 'no notice'} (${threw?.message ?? 'no throw'}; ${c.registered.length} contributions; ${JSON.stringify(c.status)}; ${JSON.stringify(toasts)})`)
  }
  let threw = null
  try {
    oldMod.default.register({ register() {}, onEvent() {}, onDispose() {}, i18n: { register() {} } })
  } catch (e) {
    threw = e
  }
  await settle()
  check(!threw, `13e. without ${name} and without ctx.rest, register does not throw (${threw?.message ?? 'no throw'})`)
}

// 1. dispose
disposers.forEach(fn => fn())
check(stub.host.state.focusedSessionId.subs.size === 0 && stub.host.state.focusedStoredSessionId.subs.size === 0, 'dispose retires the focus listeners')
act(() => { strip.root.unmount(); ROWS.forEach(id => rows[id].root.unmount()) })
console.error = consoleError

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
process.exitCode = failures ? 1 : 0
