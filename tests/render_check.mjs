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
 *   2. Which replies: status complete, not a reused reply, a string of any length, in a chat the
 *      user has opened in this app; the backend alone decides whether the turn is checked. A
 *      subagent mirror (no status), an error, an interrupted or a reused frame, or a chat never
 *      opened is never sent; the desktop half has no length floor (mod.MIN_CHARS is undefined).
 *   3. Once per reply: the same frame again is not checked twice; a reply differing only at its end
 *      is a different reply (the key covers the whole text); two turns with the same short text and
 *      different final row ids are both posted.
 *   4. The request: POST /check with exactly { session_id, turn } — the stored id of the reply's OWN
 *      chat (even when another chat is in focus) and the frame's persisted_turn receipt as is; never
 *      the reply's text. A frame without a receipt still posts, with turn: null; the backend's
 *      skip answer { points: [], skipped } shows no note and no toast (the user's live case).
 *   5. The strip: only its hidden live line when no note is pending; a point is a note, never a
 *      toast. One note: the label "Worth knowing · <kind>", no number, headline, sentence, meta
 *      "<model> · <cost> · decided by ...", "Ask in chat" for the focused chat ("Open" for another
 *      chat), "Got it", then the Rate group "Already knew", "Not sure", "Not useful".
 *      Several notes: "Worth knowing · N notes", numbered 1..N in arrival order; the focused chat's
 *      note expanded (meta led by its kind), the others one line "<kind> · <title> · <model> <cost>"
 *      ("Untitled chat" without a title) with "Open" only.
 *   6. Buttons (click() lets the undo window close; lock 26 holds it open): "Open" opens that note's
 *      own chat and keeps the note (it expands once that chat is focused); "Got it" removes only that
 *      note and posts /dismiss { check_at, signal: 'read' };
 *      "Already knew" removes it and posts /dismiss { check_at, signal: 'already_knew' } with that
 *      check's `at`; "Not sure" and "Not useful" the same with signal 'unsure' and 'not_useful' (lock
 *      24); a failed /dismiss is one named error toast; the last note gone, the strip is gone.
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
 *      an SDK without SESSION_ROW_AREAS, without COMPOSER_AREAS or whose host has no
 *      composer.insertText imports, and register does not throw, registers nothing, adds no listener,
 *      posts /status { desktop_ready: false } once (and no /notes) and shows the update warning only
 *      when the answer says update_notice: true.
 *  14. No model chosen: a /check failure naming "no model chosen" is one asterisk-no-model warning
 *      with its copy, never the asterisk-error toast; a second one adds no notice; checking does not
 *      stop, so the next reply is still posted (a model chosen mid-session works on the next reply).
 *      A reply without `model` names no model and leaves no stray separator.
 *  23. Note actions (4.2.0):
 *      (a) buttons: the focused chat's single note [Ask in chat] [Got it] [Already knew] [Not sure]
 *          [Not useful]; a single note of another chat [Open] [Got it] [Already knew] [Not sure]
 *          [Not useful]; a one-line note [Open] only.
 *      (b) Ask in chat: one host.composer.insertText(the note's storedId, "Asterisk: <headline> —
 *          <text>", { mode: 'block' }), a Playful note's kind label in place of its headline (an
 *          unknown kind keeps the headline); true -> the note leaves and /dismiss { check_at, signal:
 *          'asked' } is posted; false or a throw -> the note stays, nothing posted, one
 *          asterisk-ask-failed warning; two clicks while pending -> one call; long text in full.
 *      (c) Got it posts signal 'read', Already knew 'already_knew'; a failed post names the button.
 *      (d) fold: the chevron (aria-expanded, Collapse / Expand) folds the strip to "Worth knowing ·
 *          N notes" (one note: its kind) and the focused or newest headline, no stroke, no entry,
 *          dots and REST untouched; unfolds with every note in
 *          order; a new live note unfolds it; reduced motion animates nothing inline and every CSS
 *          transition or animation is keyed on [data-motion="full"].
 *      (e) restart: a fresh registration posts /notes {} once after /status (never when ready: false
 *          or old_install: true; still after a failed or malformed /status) and shows the backend's
 *          entries in `at` order, focused one with Ask in chat, the right dots, no pet line, folding
 *          unchanged; an entry without a headline is skipped silently; a live note it also holds
 *          shows once; a note dismissed while /notes is pending is not restored; a failed /notes is
 *          one asterisk-restore-error toast.
 *      (f) 13e's variant without host.composer.insertText.
 *      (g) every t() key resolves, the new ones included (lock 11's count raised).
 *  24. Not sure and Not useful (4.3.0):
 *      (a) every expanded note offers five buttons [Ask in chat | Open] [Got it] [Already knew]
 *          [Not sure] [Not useful]: focused, another chat's, the expanded note of a numbered list,
 *          under reduced motion and restored; the last three are .asterisk-quiet in a "Rate" group.
 *      (b)-(d) run once for Not useful (signal 'not_useful') and once for Not sure ('unsure'):
 *      (b) the button on a single note removes it, posts /dismiss { check_at, signal } with its
 *          check's `at`, shows no toast; the last note gone, the strip and the chat's dot go.
 *      (c) the button on the expanded note of a numbered list removes only that note, renumbers
 *          the rest and posts its signal.
 *      (d) a failed /dismiss from it is one toast 'Could not record "<label>": <detail>'.
 *      (e) CSS: .asterisk-actions keeps flex-wrap:wrap, and .asterisk-entry and
 *          .asterisk-entry.asterisk-numbered keep their minmax(0,1fr) text column (the jsdom half of
 *          "the row fits"; tests/preview_strip.mjs measures it).
 *      (f) the keys 'asterisk.notSure' and 'asterisk.notUseful' resolve (lock 23g's count raised).
 *  25. The settings page (see its checks): kinds with switches, tone radios, the report tables, the
 *      suggestion, save and load errors.
 *  26. The interface pass (4.6.0):
 *      (a) the live line: the strip is not itself aria-live; a hidden .asterisk-sr line (polite)
 *          holds "Worth knowing: <headline>" of the newest live note, and stays mounted with no note.
 *      (b) headline and buttons: the headline is an h3 with an id that every button of its note
 *          names in aria-describedby; Ask in chat (Open) is .asterisk-primary.
 *      (c) kind and severity: a single note's label names its kind; an irreversible or security
 *          note carries data-severity="high" on its entry and kind tag; a one-line note has no stroke.
 *      (d) undo: a rating or Got it removes the note at once and holds its /dismiss for 5 s behind
 *          "Recorded: <label>." and Undo; Undo puts the note back in place and posts nothing; a
 *          second click closes the first window (posting it); the window closing posts the
 *          signal; dispose posts an open window. Ask in chat posts at once.
 *      (e) keys: Escape inside the strip folds it; in the tone group the arrow keys select and
 *          focus the next or previous tone, wrapping; only the checked tone is tabbable and has the
 *          hidden check mark.
 *      (f) settings: the locked reason is said once under Priority 1 and describes both locked
 *          switches; the suggestion sits in its kind's row; rare outcome columns (filtered,
 *          dropped, chat deleted, unrecorded) appear only when a kind row has one, with their
 *          legend line; model and tone tables show money and rated columns; model ids carry a
 *          title; a pending save marks controls aria-disabled (they keep focus) and shows "Saving…",
 *          and a click meanwhile sends nothing.
 *      (g) CSS: no font size under 12px in the strip or the page, 24px targets, a high note's
 *          stroke in --ui-red without animation, no side border thicker than 1px.
 *  27. A chat deleted while the app runs (4.6.1): sessions.changed posts /notes {} only while a
 *      note or an undo window is pending, one request at a time with one trailing request for
 *      changes meanwhile; the notes (and a held rating) of each chat in the answer's gone list
 *      leave the strip unposted and their dots go; a failed /notes keeps the notes, no toast; each
 *      new note also asks once, so a chat deleted while its check ran loses the note at once.
 *  REST counts in locks 1-12 count /check and /dismiss calls only (/status and /notes have their own
 *  lists). The stub's host.composer.insertText records its calls and resolves a settable result, or
 *  rejects, or waits (deferred) until the lock resolves it.
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
writeFileSync(path.join(OUT, 'react-hooks.mjs'), `import { createRequire } from 'node:module'
const R = createRequire(${anchor})('react')
export const useEffect = R.useEffect
`)
// The SDK stub; an old core's SDK is the same without SESSION_ROW_AREAS, COMPOSER_AREAS or
// host.composer.insertText.
const stubSource = ({ composer = true, rows = true, insert = true } = {}) => `import { createRequire } from 'node:module'
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
export const calls = { notify: [], opened: [], revealPane: [], insert: [] }
// composer.insertText records each call, then rejects with composer.throws, waits (deferred) until a
// test resolves composer.pending, or resolves composer.result.
export const composer = { result: true, throws: null, deferred: false, pending: [] }
export const host = {
  state: { focusedSessionId: atom('rt-1'), focusedStoredSessionId: atom('st-1') },
  notify: n => { calls.notify.push(n) },
  openSession: async sid => { calls.opened.push(sid) },
  revealPane: (...a) => { calls.revealPane.push(a) },
  ${insert ? `composer: {
    insertText: (sid, text, opts) => {
      calls.insert.push([sid, text, opts])
      if (composer.throws) return Promise.reject(new Error(composer.throws))
      if (composer.deferred) return new Promise(r => { composer.pending.push(r) })
      return Promise.resolve(composer.result)
    }
  }` : ''}
}
`
const source = readFileSync(SRC, 'utf8')
const href = f => `'${pathToFileURL(path.join(OUT, f)).href}'`
/** plugin.js against a given stub, as a module file; every SDK import specifier is pointed at the stub. */
const variant = (stubFile, pluginFile, opts) => {
  writeFileSync(path.join(OUT, stubFile), stubSource(opts))
  writeFileSync(path.join(OUT, pluginFile),
    source.replaceAll("'@hermes/plugin-sdk'", href(stubFile)).replace("'react/jsx-runtime'", href('react-jsx.mjs')).replace("from 'react'", `from ${href('react-hooks.mjs')}`))
}
variant('sdk-stub.mjs', 'plugin-under-test.mjs')
const stub = await import(pathToFileURL(path.join(OUT, 'sdk-stub.mjs')).href)
const mod = await import(pathToFileURL(path.join(OUT, 'plugin-under-test.mjs')).href)

let failures = 0
let SETTINGS_TEXT = ''
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`)
  if (!ok) failures++
}
const settle = () => new Promise(r => setTimeout(r, 0))
// The undo window: a 5 s timer is held here instead of running; elapse() runs the held ones (the
// window closing), so a lock decides whether a click's /dismiss goes out now or after Undo.
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const held = new Map()
let heldSeq = 0
globalThis.setTimeout = (fn, ms, ...a) => {
  if (ms !== 5000) return realSetTimeout(fn, ms, ...a)
  const id = `held-${++heldSeq}`
  held.set(id, () => fn(...a))
  return id
}
globalThis.clearTimeout = id => (typeof id === 'string' && id.startsWith('held-') ? held.delete(id) : realClearTimeout(id))
const elapse = () => act(async () => {
  const due = [...held.values()]
  held.clear()
  due.forEach(fn => fn())
  await settle()
})
const reactWarnings = []
const consoleError = console.error
console.error = (...a) => { reactWarnings.push(a.map(String).join(' ')) }

// ── fake ctx ────────────────────────────────────────────────────────────────
const registered = []
const listeners = new Map()
const disposers = []
const rest = [] // /check and /dismiss calls; /status goes to statusCalls, /notes to notesCalls
const statusCalls = []
const pages = [] // registerSettingsPage calls
const notesCalls = []
let notesAnswer = { notes: [] }
let reply = { points: [], cost_usd: 0.0213, cost_status: 'estimated', model: 'fake-model-x', at: 1, title: null }
let restFails = null
const pet = { visible: false, said: [] }
const ctx = {
  register: c => { registered.push(c); return () => {} },
  i18n: { register: b => { ctx.bundle = b; stub.i18n.bundle = b }, t: key => mod.t(key) },
  registerSettingsPage: p => { pages.push(p); return () => {} },
  onEvent: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type).delete(fn) },
  onDispose: fn => { disposers.push(fn) },
  rest: async (p, opts) => {
    if (p === '/status') {
      statusCalls.push(opts)
      return { ready: true, update_notice: false, old_install: false }
    }
    if (p === '/notes') {
      notesCalls.push(opts)
      const a = typeof notesAnswer === 'function' ? await notesAnswer() : notesAnswer
      if (a instanceof Error) throw a
      return a
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
const clickHeld = el => act(async () => { el.click(); await settle() })
const click = async el => { await clickHeld(el); await elapse() }
// The note's action buttons; the header's chevron (no text) is checked on its own.
const buttons = el => $$(el, 'button:not([data-asterisk="fold"])').map(b => text(b))
const button = (el, label) => $$(el, 'button').find(b => text(b) === label)

// 1. registration
mod.default.register(ctx)
await settle()
await settle()
const areas = registered.map(c => c.area)
check(registered.length === 2 && same(areas, ['composer.top', 'sessionRow.trailing']),
  `exactly two contributions: composer.top and sessionRow.trailing (${JSON.stringify(areas)})`)
const stripC = registered.find(c => c.area === 'composer.top')
const dotC = registered.find(c => c.area === 'sessionRow.trailing')
check(typeof stripC?.render === 'function' && typeof dotC?.data?.render === 'function' && !registered.some(c => /pane|settings|nav/i.test(String(c.area))),
  'composer.top has a render, sessionRow.trailing a data.render; no pane, page or nav row')
check(ctx.bundle?.en?.asterisk?.title === 'Asterisk' && ctx.bundle?.en?.asterisk?.label === 'Worth knowing', 'the English bundle is registered')
check(listeners.get('message.complete')?.size === 1 && listeners.get('sessions.changed')?.size === 1 && listeners.size === 2, 'one listener on message.complete and one on sessions.changed, nothing else')
check(stub.host.state.focusedSessionId.subs.size === 1 && stub.host.state.focusedStoredSessionId.subs.size === 1, 'focus is followed')
check(statusCalls.length === 1 && same(statusCalls[0], { method: 'POST', body: { desktop_ready: true } }) && stub.calls.notify.length === 0,
  `13a. registration posts /status { desktop_ready: true } once; ready, no old install -> no notice (${JSON.stringify(statusCalls)})`)
check(notesCalls.length === 1 && same(notesCalls[0], { method: 'POST', body: {} }) && rest.length === 0,
  `23e. once /status settles, registration posts /notes {} once; nothing else (${JSON.stringify(notesCalls)})`)

const strip = mount(createElement(stripC.render))
const ROWS = ['st-1', 'st-2', 'st-3', 'st-4', 'st-5']
function Row({ sessionId }) {
  return dotC.data.render({ sessionId })
}
const rows = Object.fromEntries(ROWS.map(id => [id, mount(createElement(Row, { sessionId: id }))]))
const dots = () => Object.fromEntries(ROWS.map(id => [id, $$(rows[id].el, '[data-asterisk="dot"]').length]))
const live = () => $(strip.el, '[data-asterisk="live"]')
const stripGone = () => !$(strip.el, '[data-asterisk="strip"]') && !$(strip.el, '[data-asterisk="undo"]') && $$(strip.el, '*').every(e => ['STYLE', 'SPAN'].includes(e.tagName))
check(stripGone() && live()?.getAttribute('aria-live') === 'polite' && live()?.className === 'asterisk-sr' && text(live()) === ''
  && ROWS.every(id => rows[id].el.innerHTML === ''),
  '26. with no notes the strip renders only its hidden, empty live line (aria-live polite, .asterisk-sr) and no row has a dot')
check(stub.i18n.ids.has('asterisk'), 'React copy comes from usePluginI18n(\'asterisk\')')

// 2. which replies
check(mod.eligible({ status: 'complete', text: long('x') }), 'a complete long reply is eligible')
check(!mod.eligible({ text: long('x') }), 'a subagent mirror (no status) is not')
check(!mod.eligible({ status: 'error', text: long('x') }) && !mod.eligible({ status: 'interrupted', text: long('x') }), 'an error or interrupted turn is not')
check(!mod.eligible({ status: 'complete', text: long('x'), response_reused: true }), 'a reply this turn already delivered is not')
check(mod.eligible({ status: 'complete', text: 'Done.' }) && mod.eligible({ status: 'complete', text: 'A'.repeat(2999) }) && mod.MIN_CHARS === undefined,
  'a complete short reply is eligible: the desktop half has no length floor (mod.MIN_CHARS is undefined)')
check(!mod.eligible({ status: 'complete', text: { parts: [long('x')] } }), 'a non-string text is not')
await emit('rt-never', { status: 'complete', text: long('never') })
check(rest.length === 0, 'a reply in a chat never opened here is not sent')
await emit('rt-1', { text: long('mirror') })
check(rest.length === 0, 'a mirror frame is not sent')
await emit('rt-1', { status: 'error', text: 'Done.', persisted_turn: receipt(5) })
await emit('rt-1', { status: 'interrupted', text: 'Done.', persisted_turn: receipt(5) })
await emit('rt-1', { status: 'complete', text: 'Done.', response_reused: true, persisted_turn: receipt(5) })
check(rest.length === 0, 'an error, an interrupted or a reused frame is not sent')

// 3/4/5. one note, in the focused chat
const H1 = 'SQLite chosen over Postgres'
reply = { points: [point(H1, 'The assistant chose SQLite over Postgres without saying it drops concurrent writes.')],
  cost_usd: 0.0213, cost_status: 'estimated', model: 'fake-model-x', at: 1000.5, title: 'Deploy plan' }
await emit('rt-1', frame('one', 10))
const body1 = rest[0]?.[1]?.body
check(rest.length === 1 && rest[0][0] === '/check' && rest[0][1]?.method === 'POST', 'a long reply of the focused chat is sent to POST /check')
check(same(Object.keys(body1 || {}).sort(), ['session_id', 'turn']) && body1.session_id === 'st-1' && same(body1.turn, receipt(10)),
  `the body is { session_id, turn }: the chat's stored id and the frame's receipt as is (${JSON.stringify(body1)})`)
check(!('text' in (body1 || {})) && !JSON.stringify(body1).includes(LONG.slice(0, 50)), 'the reply\'s text is not sent')
check(stub.calls.notify.length === 0, `a point is a note, not a toast (${stub.calls.notify.length} notify calls)`)
let s = $(strip.el, '[data-asterisk="strip"]')
check(s?.getAttribute('data-count') === '1' && s?.getAttribute('role') === 'region' && s?.getAttribute('aria-label') === 'Worth knowing'
  && !s?.hasAttribute('aria-live') && text(live()) === `Worth knowing: ${H1}` && !s.contains(live()),
  `26. one strip, data-count 1, a labelled region that is not itself live; the hidden live line names the new note (${text(live())})`)
check(text($(s, '[data-asterisk="label"]')) === 'Worth knowing · Unstated tradeoff' && text($(s, '.asterisk-label-name')) === 'Worth knowing'
  && $(s, '[data-asterisk="label"] [data-asterisk="kind"]') && !$(s, '[data-asterisk="label"] [data-asterisk="kind"]').hasAttribute('data-severity'),
  `26. a single note's label names its kind: "Worth knowing · Unstated tradeoff" (${text($(s, '[data-asterisk="label"]'))})`)
let entries = $$(strip.el, '[data-asterisk="entry"]')
check(entries.length === 1 && $(s, 'ol') && entries[0].parentElement.tagName === 'OL' && $$(s, '[data-asterisk="num"]').length === 0,
  'one entry in an ordered list, no number for a single note')
check(text($(entries[0], '[data-asterisk="headline"]')) === H1 && text($(entries[0], '[data-asterisk="text"]')).startsWith('The assistant chose SQLite'),
  'the entry shows the headline and the sentence')
const stroke = $(entries[0], '[data-asterisk="stroke"]')
check(stroke?.getAttribute('aria-hidden') === 'true' && stroke?.getAttribute('viewBox') === '0 0 200 8' && stroke?.getAttribute('preserveAspectRatio') === 'none'
  && stroke?.querySelector('path')?.getAttribute('d') === 'M2 5 C 40 2, 80 7, 120 4 S 180 3, 198 5', 'the headline is underlined by the hidden SVG stroke')
check(text($(entries[0], '[data-asterisk="meta"]')) === 'fake-model-x · ~$0.02 · decided by assistant', `meta: the model that answered, the cost, who decided (${text($(entries[0], '[data-asterisk="meta"]'))})`)
const FOCUSED5 = ['Ask in chat', 'Got it', 'Already knew', 'Not sure', 'Not useful']
const OTHER5 = ['Open', 'Got it', 'Already knew', 'Not sure', 'Not useful']
const rateGroup = $(strip.el, '.asterisk-rate')
const hid = $(entries[0], 'h3.asterisk-headline')?.id
check(same(buttons(strip.el), FOCUSED5) && $$(strip.el, 'button').every(b => b.getAttribute('type') === 'button')
  && button(strip.el, 'Ask in chat')?.className === 'asterisk-btn asterisk-primary' && button(strip.el, 'Got it')?.className === 'asterisk-btn asterisk-gotit'
  && ['Already knew', 'Not sure', 'Not useful'].every(l => button(strip.el, l)?.className === 'asterisk-btn asterisk-quiet' && rateGroup?.contains(button(strip.el, l)))
  && rateGroup?.getAttribute('role') === 'group' && rateGroup?.getAttribute('aria-label') === 'Rate' && !rateGroup.contains(button(strip.el, 'Got it')),
  `23a/24a/26. the focused chat's single note offers [Ask in chat] (primary) [Got it], then a "Rate" group [Already knew] [Not sure] [Not useful]; no "Open" (${buttons(strip.el)})`)
check(Boolean(hid) && $$(entries[0], 'button').every(b => b.getAttribute('aria-describedby') === hid) && text(document.getElementById(hid)) === H1,
  `26. the headline is an h3 with an id, and every button of the note is described by it (${hid})`)
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
reply = { points: [], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 1500, title: null }
await emit('rt-1', frame('back', 15))
check(rest.at(-1)?.[1]?.body?.session_id === 'st-1',
  `the stored atom set before the runtime one does not file the old chat under the new id (${rest.at(-1)?.[1]?.body?.session_id})`)
await focus('rt-3', 'st-3')
pet.visible = true
reply = { points: [point('Old backups deleted', 'You asked to delete the old backups; the reply calls it a cleanup.', 'user', 'irreversible')],
  cost_usd: 0.004, cost_status: 'estimated', model: 'fake-model-x', at: 2000.25, title: null }
await emit('rt-2', frame('two', 20))
const body2 = rest.at(-1)?.[1]?.body
check(body2?.session_id === 'st-2' && same(body2?.turn, receipt(20)),
  `a reply finishing in a chat not in focus sends THAT chat's stored id, not the focused one (${body2?.session_id})`)
check(pet.said.length === 1 && pet.said[0][0] === 'Worth knowing: a note above the input' && pet.said[0][1]?.tone === 'info',
  `with a pet on screen it points to the strip (${JSON.stringify(pet.said)})`)
reply = { points: [point('Release tag pushed', 'The assistant pushed the release tag before the tests finished.')],
  cost_usd: 0.0412, cost_status: 'estimated', model: 'fake-model-x', at: 3000.75, title: 'Release notes' }
await emit('rt-3', frame('three', 30))
s = $(strip.el, '[data-asterisk="strip"]')
entries = $$(strip.el, '[data-asterisk="entry"]')
check(s?.getAttribute('data-count') === '3' && text($(s, '[data-asterisk="label"]')) === 'Worth knowing · 3 notes',
  `three notes: data-count 3, label "Worth knowing · 3 notes" (${text($(s, '[data-asterisk="label"]'))})`)
check(same($$(s, '[data-asterisk="num"]').map(text), ['1', '2', '3']) && same(entries.map(e => text($(e, '[data-asterisk="headline"]'))), [H1, 'Old backups deleted', 'Release tag pushed']),
  'numbered 1, 2, 3 in arrival order')
check(entries[2].getAttribute('data-expanded') === 'true' && text($(entries[2], '[data-asterisk="text"]')).startsWith('The assistant pushed')
  && text($(entries[2], '[data-asterisk="meta"]')) === 'Unstated tradeoff · fake-model-x · ~$0.04 · decided by assistant' && same(buttons(entries[2]), FOCUSED5),
  `24a. the focused chat's note of a numbered list is expanded, with [Already knew] [Not sure] [Not useful] [Ask in chat] [Got it] (${text($(entries[2], '[data-asterisk="meta"]'))} | ${buttons(entries[2])})`)
check(entries[0].getAttribute('data-expanded') === 'false' && !$(entries[0], '[data-asterisk="text"]') && text($(entries[0], '[data-asterisk="meta"]')) === 'Unstated tradeoff · Deploy plan · fake-model-x ~$0.02'
  && same(buttons(entries[0]), ['Open']), `23a. another chat's note is one line "<title> · <model> <cost>" and only "Open" (${text($(entries[0], '[data-asterisk="meta"]'))} | ${buttons(entries[0])})`)
check(text($(entries[1], '[data-asterisk="meta"]')) === 'Irreversible step · Untitled chat · fake-model-x <$0.01' && same(buttons(entries[1]), ['Open'])
  && $(entries[1], '[data-asterisk="kind"]')?.getAttribute('data-severity') === 'high' && entries[1].getAttribute('data-severity') === 'high'
  && !entries[0].hasAttribute('data-severity') && !$(entries[1], '[data-asterisk="stroke"]') && $(entries[2], '[data-asterisk="stroke"]'),
  `a note without a title shows "Untitled chat" (${text($(entries[1], '[data-asterisk="meta"]'))})`)
check(same(dots(), { 'st-1': 1, 'st-2': 1, 'st-3': 1, 'st-4': 0, 'st-5': 0 }) && $$(rows['st-2'].el, '[data-asterisk="dot"]')[0]?.getAttribute('aria-label') === 'Worth knowing: a note waiting'
  && $$(rows['st-2'].el, '[data-asterisk="dot"]')[0]?.getAttribute('title') === 'Worth knowing: a note waiting',
  `one labelled dot on each chat with a pending note, nothing on the others (${JSON.stringify(dots())})`)
collect(strip.el)
ROWS.forEach(id => collect(rows[id].el))

// 23d. fold: the chevron folds the strip to its label and back; the notes, the dots and the backend are untouched
const HEADS3 = [H1, 'Old backups deleted', 'Release tag pushed']
const DOTS3 = { 'st-1': 1, 'st-2': 1, 'st-3': 1, 'st-4': 0, 'st-5': 0 }
let fold = $(strip.el, '[data-asterisk="fold"]')
const chevron = $(fold, 'svg')
check(fold?.tagName === 'BUTTON' && fold.getAttribute('type') === 'button' && fold.classList.contains('asterisk-fold') && fold.getAttribute('aria-expanded') === 'true'
  && fold.getAttribute('aria-label') === 'Collapse' && fold.getAttribute('title') === 'Collapse' && fold.parentElement?.classList.contains('asterisk-head')
  && fold.parentElement === $(s, '[data-asterisk="label"]')?.parentElement && !$(s, '[data-asterisk="label"]').contains(fold)
  && chevron?.getAttribute('aria-hidden') === 'true' && chevron?.getAttribute('viewBox') === '0 0 12 12'
  && chevron?.querySelector('path')?.getAttribute('d') === 'M3 7.5 L6 4.5 L9 7.5' && chevron?.querySelector('path')?.getAttribute('stroke') === 'currentColor'
  && s.getAttribute('data-folded') === 'false',
  `23d. the chevron sits beside the label in div.asterisk-head: aria-expanded "true", label "Collapse", hidden 12x12 SVG in currentColor (${fold?.outerHTML.slice(0, 200)})`)
const restFold = rest.length, notesFold = notesCalls.length, statusFold = statusCalls.length
await click(fold)
s = $(strip.el, '[data-asterisk="strip"]')
fold = $(strip.el, '[data-asterisk="fold"]')
let label = $(s, '[data-asterisk="label"]')
check(s?.getAttribute('data-folded') === 'true' && !$(s, 'ol') && $$(strip.el, '[data-asterisk="entry"]').length === 0
  && text($(label, '.asterisk-label-name')) === 'Worth knowing' && text($(label, '.asterisk-label-count')) === '· 3 notes'
  && text($(label, '[data-asterisk="peek"]')) === 'Release tag pushed' && !$(label, '[data-asterisk="stroke"]')
  && fold?.getAttribute('aria-expanded') === 'false' && fold?.getAttribute('aria-label') === 'Expand' && fold?.getAttribute('title') === 'Expand'
  && same(dots(), DOTS3) && rest.length === restFold && notesCalls.length === notesFold && statusCalls.length === statusFold && s.getAttribute('data-count') === '3',
  `23d/26. a click folds: data-folded "true", no entry, label "Worth knowing · 3 notes" and the focused chat's headline, no stroke, "Expand", dots unchanged, no REST call (${text(label)} | ${JSON.stringify(dots())})`)
collect(strip.el)
reduce = true
strip.rerender(createElement(stripC.render))
check($(strip.el, '[data-asterisk="strip"]')?.getAttribute('data-motion') === 'reduce' && $(strip.el, '[data-asterisk="strip"]')?.getAttribute('data-folded') === 'true'
  && !$$(strip.el, '*').some(e => /animation|transition/i.test(e.getAttribute('style') || '')),
  '23d. folded under reduced motion: no inline style animates')
reduce = false
strip.rerender(createElement(stripC.render))
await click($(strip.el, '[data-asterisk="fold"]'))
s = $(strip.el, '[data-asterisk="strip"]')
entries = $$(strip.el, '[data-asterisk="entry"]')
check(s?.getAttribute('data-folded') === 'false' && same(entries.map(e => text($(e, '[data-asterisk="headline"]'))), HEADS3)
  && same($$(s, '[data-asterisk="num"]').map(text), ['1', '2', '3']) && text($(s, '[data-asterisk="label"]')) === 'Worth knowing · 3 notes'
  && $(s, '[data-asterisk="fold"]')?.getAttribute('aria-expanded') === 'true' && same(dots(), DOTS3) && rest.length === restFold && notesCalls.length === notesFold,
  `23d. a second click unfolds with every note back in order, "Collapse" again, no REST call (${entries.map(e => text($(e, '[data-asterisk="headline"]')))})`)

// 8. motion
check(s?.getAttribute('data-motion') === 'full' && same(entries.map(e => e.style.animationDelay), ['0ms', '80ms', '160ms']),
  `no reduced motion: data-motion "full", entries staggered 0/80/160 ms (${entries.map(e => e.style.animationDelay)})`)
reduce = true
strip.rerender(createElement(stripC.render))
s = $(strip.el, '[data-asterisk="strip"]')
check(s?.getAttribute('data-motion') === 'reduce' && !$$(strip.el, '*').some(e => e.style?.animationDelay || /animation-delay/i.test(e.getAttribute('style') || '')),
  'reduced motion: data-motion "reduce" and no inline animation-delay on any element')
const reducedEntries = $$(strip.el, '[data-asterisk="entry"]')
check(reducedEntries[2]?.getAttribute('data-expanded') === 'true' && same(buttons(reducedEntries[2]), FOCUSED5),
  `24a. under reduced motion the expanded note still offers [Already knew] [Not sure] [Not useful] [Ask in chat] [Got it] (${buttons(reducedEntries[2] ?? strip.el)})`)
const css = text($(strip.el, 'style'))
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }))
check(rules.some(r => r.sel.includes('[data-motion="reduce"]') && r.sel.includes('stroke') && /stroke-dashoffset:\s*0\b/.test(r.body)),
  'the CSS shows the stroke fully drawn (dash offset 0) under [data-motion="reduce"]')
const animated = rules.filter(r => /(^|;)\s*animation\s*:/.test(r.body))
check(animated.length >= 2 && animated.every(r => r.sel.includes('[data-motion="full"]')), `every animation is keyed on [data-motion="full"] (${animated.map(r => r.sel)})`)
const moving = rules.filter(r => /(^|;)\s*(transition|animation)\s*:/.test(r.body))
check(moving.some(r => /(^|;)\s*transition\s*:/.test(r.body) && r.sel.includes('asterisk-fold')) && moving.every(r => r.sel.includes('[data-motion="full"]'))
  && rules.some(r => r.sel.includes('.asterisk-fold[aria-expanded="false"]') && /transform:\s*rotate\(180deg\)/.test(r.body)),
  `23d. folded rotates the chevron 180deg; every transition or animation in the CSS is keyed on [data-motion="full"] (${moving.map(r => r.sel)})`)
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
  && text($(entries[2], '[data-asterisk="meta"]')) === 'Unstated tradeoff · Release notes · fake-model-x ~$0.04', 'once that chat is focused its note is expanded, the others collapse')

// 6. Got it
let posts = rest.length
await click(button(entries[0], 'Got it'))
entries = $$(strip.el, '[data-asterisk="entry"]')
check(entries.length === 2 && same($$(strip.el, '[data-asterisk="num"]').map(text), ['1', '2']) && rest.length === posts + 1
  && same(entries.map(e => text($(e, '[data-asterisk="headline"]'))), ['Old backups deleted', 'Release tag pushed']),
  '"Got it" removes only that note (3 -> 2, renumbered 1, 2)')
check(same(rest.at(-1), ['/dismiss', { method: 'POST', body: { check_at: 1000.5, signal: 'read' } }]),
  `23c. "Got it" posts /dismiss { check_at, signal: 'read' } with its check's at (${JSON.stringify(rest.at(-1))})`)
check(same(dots(), { 'st-1': 0, 'st-2': 1, 'st-3': 1, 'st-4': 0, 'st-5': 0 }), `a chat's last note dismissed, its dot goes (${JSON.stringify(dots())})`)

// 6. Already knew
await focus('rt-2', 'st-2')
entries = $$(strip.el, '[data-asterisk="entry"]')
await click(button(entries[0], 'Already knew'))
check(rest.length === posts + 2 && same(rest.at(-1), ['/dismiss', { method: 'POST', body: { check_at: 2000.25, signal: 'already_knew' } }])
  && $$(strip.el, '[data-asterisk="entry"]').length === 1, `23c. "Already knew" removes the note and posts /dismiss { check_at, signal: 'already_knew' } with its check's at (${JSON.stringify(rest.at(-1))})`)
entries = $$(strip.el, '[data-asterisk="entry"]')
check(text($(strip.el, '[data-asterisk="label"]')) === 'Worth knowing · Unstated tradeoff' && $$(strip.el, '[data-asterisk="num"]').length === 0
  && text($(entries[0], '[data-asterisk="meta"]')) === 'Release notes · fake-model-x · ~$0.04 · decided by assistant' && same(buttons(entries[0]), OTHER5),
  `23a/24a. a single note of another chat is expanded, names its chat and offers [Already knew] [Not sure] [Not useful] [Open] [Got it] (${text($(entries[0], '[data-asterisk="meta"]'))} | ${buttons(entries[0])})`)
collect(strip.el)
restFails = 'network down'
const warn = console.warn
console.warn = () => {}
await click(button(entries[0], 'Already knew'))
let n = stub.calls.notify.at(-1)
check(stub.calls.notify.length === 1 && n?.id === 'asterisk-feedback-error' && n?.kind === 'error' && n?.title === 'Asterisk'
  && n?.message === 'Could not record "Already knew": network down', `23c. a failed /dismiss from "Already knew" is one named error toast (${JSON.stringify(n)})`)
check(stripGone() && ROWS.every(id => rows[id].el.innerHTML === ''), 'the last note removed, the strip and every dot are gone')

// 10. errors
const toasts = stub.calls.notify.length
restFails = null
reply = { points: [{ kind: 'cost', by: 'user', text: 'No headline here.' }], cost_usd: 0.02, cost_status: 'estimated', model: 'fake-model-x', at: 4000, title: 'X' }
await emit('rt-3', frame('four', 40))
n = stub.calls.notify.at(-1)
check(stub.calls.notify.length === toasts + 1 && n?.id === 'asterisk-error' && n?.message === 'Could not check a reply: the answer has no headline'
  && stripGone(), `a point without a headline is one error toast and no note (${n?.message})`)
reply = { points: [], cost_usd: 0.02, cost_status: 'estimated', model: 'fake-model-x', at: 4001, title: null }
await emit('rt-3', frame('five', 50))
check(stripGone() && stub.calls.notify.length === toasts + 1, 'nothing to flag -> no note, no toast')
restFails = 'model call failed (APITimeoutError)'
await emit('rt-3', frame('six', 60))
n = stub.calls.notify.at(-1)
check(n?.kind === 'error' && n?.id === 'asterisk-error' && n?.message === 'Could not check a reply: model call failed (APITimeoutError)',
  `a failed check is one error toast that names the error (${n?.message})`)
// 2/3/4. short replies: posted with or without a receipt; same text, different final row ids, posted twice;
// the user's live case: no receipt, the backend skips (no_receipt) -> no note, no toast
restFails = null
reply = { points: [], skipped: 'no_receipt' }
const toastsShort = stub.calls.notify.length
let before = rest.length
await emit('rt-3', { status: 'complete', text: 'Done.', persisted_turn: receipt(70) })
check(rest.length === before + 1 && same(rest.at(-1)?.[1]?.body, { session_id: 'st-3', turn: receipt(70) }),
  `a complete short reply with a receipt is posted (${JSON.stringify(rest.at(-1)?.[1]?.body)})`)
await emit('rt-3', { status: 'complete', text: 'Done.', persisted_turn: receipt(80) })
await emit('rt-3', { status: 'complete', text: 'Done.', persisted_turn: receipt(80) })
check(rest.length === before + 2 && same(rest.at(-1)?.[1]?.body?.turn, receipt(80)),
  `two frames with the same short text and different final row ids are both posted; the same frame twice once (${rest.length - before})`)
before = rest.length
await emit('rt-3', { status: 'complete', text: 'Short, no receipt.' })
const body3 = rest.at(-1)?.[1]?.body
check(rest.length === before + 1 && body3?.session_id === 'st-3' && 'turn' in body3 && body3.turn === null,
  `a complete short reply without a receipt is posted with turn: null (${JSON.stringify(body3)})`)
check(stripGone() && stub.calls.notify.length === toastsShort,
  `a skipped: 'no_receipt' answer shows no note and no toast (${stub.calls.notify.length - toastsShort} toasts)`)
// 4. a malformed receipt is still the error toast
restFails = 'turn ids missing or malformed'
await emit('rt-3', { status: 'complete', text: long('no receipt') })
console.warn = warn
n = stub.calls.notify.at(-1)
check(n?.kind === 'error' && n?.message === 'Could not check a reply: turn ids missing or malformed', `a refusal is still the error toast (${n?.message})`)
restFails = null
// 14. no model chosen for Asterisk: one warning per app start, never the error toast, later replies still posted
const NO_MODEL = 'Asterisk has no model chosen, so it checks no reply. It does not use your main model on its own. Choose one in Settings → Models → Auxiliary models → Asterisk (Change, or Set to main).'
console.warn = () => {}
const beforeNoModel = stub.calls.notify.length
restFails = '409: {"detail":"no model chosen"}'
await emit('rt-3', frame('no model 1', 70))
let added = stub.calls.notify.slice(beforeNoModel)
check(added.length === 1 && added[0].id === 'asterisk-no-model' && added[0].kind === 'warning' && added[0].title === 'Asterisk'
  && added[0].message === mod.t('asterisk.noModel') && added[0].message === NO_MODEL && !added.some(x => x.id === 'asterisk-error'),
  `14. a "no model chosen" refusal is one asterisk-no-model warning with its copy, not the error toast (${JSON.stringify(added)})`)
await emit('rt-3', frame('no model 2', 80))
added = stub.calls.notify.slice(beforeNoModel)
check(added.length === 1 && rest.at(-1)?.[0] === '/check' && rest.at(-1)?.[1]?.body?.turn?.row_ids?.[0] === 80,
  `14. a second "no model chosen" refusal is posted but adds no notice (${added.length} notices)`)
restFails = null
const postsNoModel = rest.length
reply = { points: [point('Chosen mid-session', 'The assistant kept the old schema without saying the migration was skipped.')],
  cost_usd: 0.0213, cost_status: 'estimated', at: 4100, title: 'Later chat' }
await emit('rt-3', frame('no model 3', 90))
console.warn = warn
check(rest.length === postsNoModel + 1 && rest.at(-1)?.[0] === '/check' && rest.at(-1)?.[1]?.body?.turn?.row_ids?.[0] === 90,
  `14. the next reply after a "no model chosen" refusal is still posted to /check (${rest.length - postsNoModel} posts)`)
const laterMeta = text($(strip.el, '[data-asterisk="meta"]'))
check(laterMeta === 'Later chat · ~$0.02 · decided by assistant', `a reply without model shows no model and no stray separator (${laterMeta})`)
await click(button(strip.el, 'Got it'))
check(stripGone(), 'that note dismissed, the strip is gone')

// 23b. Ask in chat: the note goes into ITS chat's composer (block mode, never sent); only a true insert removes it
console.warn = () => {}
const AH = `Long headline ${'h'.repeat(220)} end`
const AT = `A long sentence ${'s'.repeat(900)} — the very end.`
const ASK = `Asterisk: ${AH} — ${AT}`
const ASK_FAILED = "Could not put the note into this chat's input. Click into the input and try again."
const askWarnings = list => list.length > 0 && list.every(x => x.id === 'asterisk-ask-failed' && x.kind === 'warning' && x.title === 'Asterisk' && x.message === ASK_FAILED)
reply = { points: [point(AH, AT)], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 5000.5, title: 'Ask chat' }
await focus('rt-3', 'st-3')
await emit('rt-3', frame('ask', 200))
const ins = stub.calls.insert
const postsAsk = rest.length
let toastsAsk = stub.calls.notify.length
check(ins.length === 0 && same(buttons(strip.el), FOCUSED5), `23b. a note of the focused chat offers "Ask in chat"; nothing inserted yet (${buttons(strip.el)})`)
stub.composer.result = false
await click(button(strip.el, 'Ask in chat'))
let addedAsk = stub.calls.notify.slice(toastsAsk)
check(ins.length === 1 && same(ins[0], ['st-3', ASK, { mode: 'block' }]) && $$(strip.el, '[data-asterisk="entry"]').length === 1 && rest.length === postsAsk
  && addedAsk.length === 1 && askWarnings(addedAsk),
  `23b. insert answers false: one insertText(storedId, text, { mode: 'block' }) call, the note stays, nothing posted, one asterisk-ask-failed warning (${JSON.stringify(ins[0]?.[0])}, ${JSON.stringify(addedAsk)})`)
stub.composer.result = true
stub.composer.throws = 'no composer claimed it'
toastsAsk = stub.calls.notify.length
await click(button(strip.el, 'Ask in chat'))
addedAsk = stub.calls.notify.slice(toastsAsk)
check(ins.length === 2 && $$(strip.el, '[data-asterisk="entry"]').length === 1 && rest.length === postsAsk && addedAsk.length === 1 && askWarnings(addedAsk),
  `23b. insert throws: the note stays, nothing posted, one asterisk-ask-failed warning (${JSON.stringify(addedAsk)})`)
stub.composer.throws = null
stub.composer.deferred = true
toastsAsk = stub.calls.notify.length
await click(button(strip.el, 'Ask in chat'))
await click(button(strip.el, 'Ask in chat'))
check(ins.length === 3 && stub.composer.pending.length === 1 && $$(strip.el, '[data-asterisk="entry"]').length === 1 && rest.length === postsAsk,
  `23b. two clicks while an insert is pending -> one insertText call, the note waits (${ins.length - 2} calls)`)
stub.composer.deferred = false
await act(async () => {
  stub.composer.pending.splice(0).forEach(r => r(true))
  await settle()
  await settle()
})
check(stripGone() && rest.length === postsAsk + 1 && same(rest.at(-1), ['/dismiss', { method: 'POST', body: { check_at: 5000.5, signal: 'asked' } }])
  && stub.calls.notify.length === toastsAsk,
  `23b. insert answers true: the note leaves and /dismiss { check_at, signal: 'asked' } is posted, no toast (${JSON.stringify(rest.at(-1))})`)
check(ins.every(c => c[0] === 'st-3' && c[1] === ASK && same(c[2], { mode: 'block' })) && ASK.includes(AH) && ASK.includes(AT) && ASK.length === AH.length + AT.length + 13,
  `23b. a long headline and sentence are inserted in full, as "Asterisk: <headline> — <text>" (${ins.map(c => c[1].length)} chars)`)

// 23b. a Playful note asks with its kind's label, never its joke; an unknown kind keeps the headline
const PLAY_TEXT = 'You asked for the typo fix; README.md was never edited and the reply says it is done.'
for (const [kind, lead, at, row] of [['unanswered', 'Left unanswered', 5050.5, 1260], ['constructor', 'The typo survived the cleanup', 5060.5, 1270]]) {
  reply = { points: [point('The typo survived the cleanup', PLAY_TEXT, 'assistant', kind)], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at, title: 'Ask chat', tone: 'playful' }
  await emit('rt-3', frame(`playful ${kind}`, row))
  await click(button(strip.el, 'Ask in chat'))
  check(same(ins.at(-1), ['st-3', `Asterisk: ${lead} — ${PLAY_TEXT}`, { mode: 'block' }]) && stripGone(),
    `23b. a Playful ${kind} note inserts "Asterisk: ${lead} — <text>" and leaves (${JSON.stringify(ins.at(-1)?.[1])})`)
}

// 23c. a failed /dismiss from "Got it" names its button
reply = { points: [point('Got it fails', 'The assistant left the cache warm without saying so.')], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 5100.5, title: null }
await emit('rt-3', frame('gotit fails', 210))
restFails = 'network down'
toastsAsk = stub.calls.notify.length
await click(button(strip.el, 'Got it'))
restFails = null
addedAsk = stub.calls.notify.slice(toastsAsk)
check(addedAsk.length === 1 && addedAsk[0].id === 'asterisk-feedback-error' && addedAsk[0].kind === 'error' && addedAsk[0].message === 'Could not record "Got it": network down'
  && same(rest.at(-1), ['/dismiss', { method: 'POST', body: { check_at: 5100.5, signal: 'read' } }]) && stripGone(),
  `23c. a failed /dismiss from "Got it" is one named error toast 'Could not record "Got it": network down' (${JSON.stringify(addedAsk)})`)

// 24b-d run once per new button: Not useful (signal 'not_useful') and Not sure (signal 'unsure')
for (const [label, signal, shift, base] of [['Not useful', 'not_useful', 0, 212], ['Not sure', 'unsure', 500, 240]]) {
  // 24b. on a single note: it leaves, /dismiss { check_at, signal }, no toast; the strip and the dot go
  reply = { points: [point(`${label} alone`, 'The assistant said the cache was cold; it was not.')], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 5110.5 + shift, title: null }
  await emit('rt-3', frame(`${signal} alone`, base))
  const toasts24 = stub.calls.notify.length
  const posts24 = rest.length
  const dotBefore = dots()['st-3']
  await click(button(strip.el, label))
  check(dotBefore === 1 && rest.length === posts24 + 1 && same(rest.at(-1), ['/dismiss', { method: 'POST', body: { check_at: 5110.5 + shift, signal } }])
    && stub.calls.notify.length === toasts24 && stripGone() && ROWS.every(id => rows[id].el.innerHTML === ''),
    `24b. "${label}" on a single note removes it, posts /dismiss { check_at, signal: '${signal}' } with its check's at, no toast; the strip and the chat's dot are gone (${JSON.stringify(rest.at(-1))})`)

  // 24c. on the expanded note of a numbered list it removes only that note and renumbers the rest
  const heads = ['one', 'two', 'three'].map(n => `${label} list ${n}`)
  for (const [sid, headline, at, b] of [['rt-2', heads[0], 5120.5 + shift, base + 2], ['rt-3', heads[1], 5121.5 + shift, base + 4], ['rt-1', heads[2], 5122.5 + shift, base + 6]]) {
    reply = { points: [point(headline, `The assistant stated ${headline.toLowerCase()} as fact.`)], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at, title: null }
    await emit(sid, frame(headline, b))
  }
  entries = $$(strip.el, '[data-asterisk="entry"]')
  const expanded24 = entries.filter(e => e.getAttribute('data-expanded') === 'true')
  await click(button(expanded24[0] ?? entries[1], label))
  entries = $$(strip.el, '[data-asterisk="entry"]')
  check(expanded24.length === 1 && same(buttons(expanded24[0]), FOCUSED5)
    && same(entries.map(e => text($(e, '[data-asterisk="headline"]'))), [heads[0], heads[2]]) && same($$(strip.el, '[data-asterisk="num"]').map(text), ['1', '2'])
    && same(rest.at(-1), ['/dismiss', { method: 'POST', body: { check_at: 5121.5 + shift, signal } }]) && stub.calls.notify.length === toasts24,
    `24c. "${label}" on the expanded note of a numbered list removes only that note, renumbers the rest 1, 2 and posts '${signal}' (${entries.map(e => text($(e, '[data-asterisk="headline"]')))} | ${JSON.stringify(rest.at(-1))})`)
  for (const [rt, st] of [['rt-2', 'st-2'], ['rt-1', 'st-1']]) {
    await focus(rt, st)
    const open = $$(strip.el, '[data-asterisk="entry"]').find(e => e.getAttribute('data-expanded') === 'true')
    if (open) await click(button(open, 'Got it'))
  }
  await focus('rt-3', 'st-3')

  // 24d. a failed /dismiss names its button
  reply = { points: [point(`${label} fails`, 'The assistant said the port was free; it was taken.')], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 5130.5 + shift, title: null }
  await emit('rt-3', frame(`${signal} fails`, base + 10))
  restFails = 'network down'
  toastsAsk = stub.calls.notify.length
  await click(button(strip.el, label))
  restFails = null
  addedAsk = stub.calls.notify.slice(toastsAsk)
  check(stripGone() && addedAsk.length === 1 && same(addedAsk[0], { id: 'asterisk-feedback-error', kind: 'error', title: 'Asterisk', message: `Could not record "${label}": network down` })
    && same(rest.at(-1), ['/dismiss', { method: 'POST', body: { check_at: 5130.5 + shift, signal } }]),
    `24d. a failed /dismiss from "${label}" is one toast 'Could not record "${label}": network down' (${JSON.stringify(addedAsk)})`)
}

// 23d. one note folded; folded, a new live note unfolds the strip
reply = { points: [point('Folded alone', 'The assistant kept the old port without saying it is taken.')], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 5200.5, title: null }
await emit('rt-3', frame('fold one', 220))
await click($(strip.el, '[data-asterisk="fold"]'))
s = $(strip.el, '[data-asterisk="strip"]')
label = $(s, '[data-asterisk="label"]')
check(s?.getAttribute('data-folded') === 'true' && text(label) === 'Worth knowing · Unstated tradeoffFolded alone' && text($(label, '[data-asterisk="peek"]')) === 'Folded alone'
  && !$(label, '[data-asterisk="stroke"]') && $$(strip.el, '[data-asterisk="entry"]').length === 0,
  `23d/26. one note folded: label "Worth knowing · <kind>" and its headline, no stroke, no entry (${text(label)})`)
const postsFold = rest.length
reply = { points: [point('Unfolds it', 'The assistant renamed the branch without saying the PR now points nowhere.')], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 5300.5, title: null }
await emit('rt-3', frame('fold two', 230))
s = $(strip.el, '[data-asterisk="strip"]')
check(s?.getAttribute('data-folded') === 'false' && $(s, '[data-asterisk="fold"]')?.getAttribute('aria-expanded') === 'true'
  && same($$(strip.el, '[data-asterisk="entry"]').map(e => text($(e, '[data-asterisk="headline"]'))), ['Folded alone', 'Unfolds it']) && rest.length === postsFold + 1,
  `23d. folded, a new live note unfolds the strip and shows every note (${s?.getAttribute('data-folded')})`)
await click(button(strip.el, 'Got it'))
await click(button(strip.el, 'Got it'))
console.warn = warn
check(stripGone() && same(rest.slice(-2).map(r => r[1].body), [{ check_at: 5200.5, signal: 'read' }, { check_at: 5300.5, signal: 'read' }]),
  'both notes dismissed with "Got it" (two read signals), the strip is gone')
check(mod.fmtCost(null, 'unknown') === '' && mod.fmtCost(0.7, 'unknown') === '' && mod.fmtCost(0, 'included') === 'subscription' && mod.fmtCost(0.38, 'actual') === '$0.38',
  'cost text: unpriced is empty even with an amount stored, subscription named, billed as is')
const unpriced = mod.noteFor({ points: [point('H', 'T')], cost_usd: null, cost_status: 'unknown', at: 5 }, { key: 'k', storedId: 'st-9' })
check(unpriced?.cost === '' && unpriced?.model === '' && mod.t('asterisk.meta', '', 'decided by you', '', 'fake-model-x') === 'fake-model-x · decided by you'
  && mod.t('asterisk.from', 'Chat', '', 'fake-model-x') === 'Chat · fake-model-x',
  'an unpriced check names no cost, never $0')
check(mod.t('asterisk.meta', '', 'decided by you', '', '') === 'decided by you' && mod.t('asterisk.from', 'Chat', '', '') === 'Chat'
  && mod.t('asterisk.from', 'Chat', '~$0.02', '') === 'Chat · ~$0.02' && mod.t('asterisk.meta', '~$0.02', 'decided by you', 'Chat', '') === 'Chat · ~$0.02 · decided by you',
  'without a model the meta and the one-line note name no model and leave no stray separator')
check(mod.noteFor({ points: [], at: 1 }, { key: 'k' }) === null && same(Object.keys(unpriced).sort(), ['by', 'checkAt', 'cost', 'headline', 'id', 'kind', 'model', 'storedId', 'text', 'title', 'tone'])
  && mod.noteFor({ points: [point('H', 'T')], model: 'fake-model-x', at: 5 }, { key: 'k' })?.model === 'fake-model-x',
  'no points -> no note; a note is { id, storedId, title, headline, text, by, kind, tone, cost, model, checkAt }')

// 9. no asterisk
const GLYPHS = /[\u2042\u204E\u2051\u2217\u2722-\u2727\u2731-\u273D\u2749-\u274B\uFE61\uFF0A]/u
check(!GLYPHS.test(source), 'plugin.js contains no asterisk-like glyph')
const starred = texts.filter(x => x.includes('*') || GLYPHS.test(x))
check(texts.length > 10 && starred.length === 0, `no rendered text, aria-label or title has an asterisk (${texts.length} strings${starred.length ? `: ${starred}` : ''})`)

// 11. copy and theme
const KEYS_MIN = 40
const keys = [...source.matchAll(/\bt\('([a-zA-Z.]+)'/g)].map(m => m[1])
const raw = keys.filter(k => mod.t(k, 1, 'x', 'y') === k)
check(keys.length >= KEYS_MIN && raw.length === 0 && ['askInChat', 'askText', 'askFailed', 'collapse', 'expand', 'restoreFailed', 'noNotes', 'notSure', 'notUseful'].every(k => keys.includes(`asterisk.${k}`))
  && mod.t('asterisk.notSure') === 'Not sure' && mod.t('asterisk.notUseful') === 'Not useful',
  `23g/24f. every t() key resolves, the new ones included, 'asterisk.notSure' is "Not sure" and 'asterisk.notUseful' is "Not useful" (${keys.length} keys${raw.length ? `, raw: ${raw}` : ''})`)
check(mod.t('asterisk.kind.tradeoff') === 'asterisk.kind.tradeoff' && mod.t('asterisk.point') === 'asterisk.point', 'the kind labels and the toast line are retired')
const vars = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1])
check(vars.length > 5 && vars.every(v => v.startsWith('--ui-') || v.startsWith('--font-')), `the strip's CSS names only --ui-* and --font-* tokens (${[...new Set(vars)]})`)
const literal = css.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(|:\s*(?:white|black)\b/i)
check(!literal, `the strip's CSS has no literal colour (${literal?.[0] ?? 'none'})`)
const ruleFor = sel => rules.find(r => r.sel === sel)?.body ?? ''
check(/(^|;)flex-wrap:wrap(;|$)/.test(ruleFor('.asterisk-actions')) && ruleFor('.asterisk-entry').includes('minmax(0,1fr)')
  && ruleFor('.asterisk-entry.asterisk-numbered').includes('minmax(0,1fr)'),
  `24e. the actions row wraps (.asterisk-actions flex-wrap:wrap) and both entry grids keep a minmax(0,1fr) text column (${ruleFor('.asterisk-actions')})`)
check(stub.calls.revealPane.length === 0, 'host.revealPane is never called')
check(reactWarnings.length === 0, `React logged no warning (${reactWarnings.slice(0, 2).join(' | ')})`)

// 13. status: one more registration per /status answer, on the same app, disposed afterwards.
// /notes answers `notes` (an Error throws; a function is called and its promise awaited) and is
// counted apart from /check and /dismiss.
function fakeCtx(answer, { notes = { notes: [] }, pet = null } = {}) {
  const c = { registered: [], listeners: new Set(), events: new Map(), disposers: [], status: [], checks: [], notes: [], pages: [], i18n: 0,
    checkAnswer: { points: [], cost_usd: 0.01, cost_status: 'estimated', at: 9, title: null } }
  c.ctx = {
    register: x => { c.registered.push(x); return () => {} },
    i18n: { register: () => { c.i18n++ }, t: key => key },
    registerSettingsPage: p => { c.pages.push(p); return () => {} },
    onEvent: (type, fn) => {
      if (!c.events.has(type)) c.events.set(type, new Set())
      c.events.get(type).add(fn)
      if (type === 'message.complete') c.listeners.add(fn)
      return () => { c.events.get(type).delete(fn); c.listeners.delete(fn) }
    },
    onDispose: fn => { c.disposers.push(fn) },
    rest: async (p, opts) => {
      if (p === '/status') {
        c.status.push(opts)
        if (answer instanceof Error) throw answer
        return answer
      }
      if (p === '/notes') {
        c.notes.push(opts)
        const a = typeof notes === 'function' ? await notes() : notes
        if (a instanceof Error) throw a
        return a
      }
      c.checks.push([p, opts])
      return c.checkAnswer
    }
  }
  if (pet) c.ctx.pet = pet
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
check(run.c.notes.length === 0, `23e. ready: false -> /notes is never posted (${run.c.notes.length})`)
run = await statusRun({ ready: false, update_notice: false, old_install: false })
check(run.c.checks.length === 0 && run.toasts.length === 0, `13b. ready: false without update_notice -> no post and no notice (${JSON.stringify(run.toasts)})`)
run = await statusRun({ ready: true, update_notice: false, old_install: true })
check(run.c.checks.length === 0 && run.toasts.length === 1 && run.toasts[0].id === 'asterisk-old-install' && run.toasts[0].kind === 'warning'
  && run.toasts[0].title === 'Asterisk' && run.toasts[0].message === OLD,
  `13c. old_install: true -> no later /check post, one asterisk-old-install warning with its copy (${run.c.checks.length} posts, ${JSON.stringify(run.toasts)})`)
check(run.c.notes.length === 0, `23e. old_install: true -> /notes is never posted (${run.c.notes.length})`)
run = await statusRun({ ready: true, update_notice: false, old_install: false })
check(run.c.checks.length === 1 && run.c.checks[0][0] === '/check' && run.toasts.length === 0,
  `13d. ready: true, old_install: false -> the reply is posted as today, no status toast (${run.c.checks.length} posts, ${run.toasts.length} toasts)`)
check(same(run.c.notes, [{ method: 'POST', body: {} }]), `23e. ready: true -> /notes {} is posted once (${JSON.stringify(run.c.notes)})`)
for (const [name, answer] of [['a failed /status', new Error('network down')], ['a malformed /status', { ready: 'yes' }], ['an empty /status', null]]) {
  run = await statusRun(answer)
  check(run.c.checks.length === 1 && run.toasts.length === 0 && run.c.status.length === 1,
    `13d. ${name} changes nothing: the reply is posted, no toast (${run.c.checks.length} posts, ${run.toasts.length} toasts)`)
  check(same(run.c.notes, [{ method: 'POST', body: {} }]), `23e. ${name} still restores: /notes {} is posted once (${JSON.stringify(run.c.notes)})`)
}

// 13e/23f. an old core's SDK: the same plugin.js against a stub without one of the names it needs
for (const [name, opts] of [['SESSION_ROW_AREAS', { rows: false }], ['COMPOSER_AREAS', { composer: false }], ['host.composer.insertText', { insert: false }]]) {
  const key = name.toLowerCase().replaceAll('_', '-').replaceAll('.', '-')
  const lock = opts.insert === false ? '23f. 13e. ' : '13e. '
  variant(`sdk-old-${key}.mjs`, `plugin-old-${key}.mjs`, opts)
  let oldStub, oldMod, err = null
  try {
    oldStub = await import(pathToFileURL(path.join(OUT, `sdk-old-${key}.mjs`)).href)
    oldMod = await import(pathToFileURL(path.join(OUT, `plugin-old-${key}.mjs`)).href)
  } catch (e) {
    err = e
  }
  check(!err, `${lock}without ${name} plugin.js still imports (${err?.message ?? 'linked'})`)
  if (err) continue
  check(opts.insert === false ? !('composer' in oldStub.host) && 'composer' in stub.host : typeof oldStub.host.composer?.insertText === 'function',
    `${lock}the stub without ${name} ${opts.insert === false ? 'has no' : 'still has'} host.composer.insertText`)
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
    check(!threw && c.registered.length === 0 && c.pages.length === 0 && c.listeners.size === 0 && c.events.size === 0 && c.i18n === 0 && subs === 0 && c.notes.length === 0
      && same(c.status, [{ method: 'POST', body: { desktop_ready: false } }]) && (notice ? updateToast(toasts) : toasts.length === 0),
      `${lock}without ${name}, update_notice ${notice}: register does not throw, registers nothing (no settings page), adds no listener, posts /status { desktop_ready: false } once and no /notes, ${notice ? 'one update warning' : 'no notice'} (${threw?.message ?? 'no throw'}; ${c.registered.length} contributions; ${JSON.stringify(c.status)}; ${JSON.stringify(toasts)})`)
  }
  let threw = null
  try {
    oldMod.default.register({ register() {}, onEvent() {}, onDispose() {}, i18n: { register() {} } })
  } catch (e) {
    threw = e
  }
  await settle()
  check(!threw, `${lock}without ${name} and without ctx.rest, register does not throw (${threw?.message ?? 'no throw'})`)
}

// 23e. restart: a second registration (a fresh ctx) restores the backend's pending notes
const KEYS14 = ['at', 'cost_status', 'cost_usd', 'model', 'points', 'session_id', 'title', 'tone']
const stored = (session_id, at, headline, sentence, title = null) => ({ session_id, at, title, model: 'fake-model-x', cost_usd: 0.0213, cost_status: 'estimated',
  points: [{ kind: 'tradeoff', by: 'assistant', headline, text: sentence }], tone: 'plain' })
const READY = { ready: true, update_notice: false, old_install: false }
const E1 = stored('st-5', 7100.5, 'Restored first', 'The assistant reused the old token without saying it expires today.', 'Old chat')
const E2 = stored('st-4', 7200.5, 'Restored second', 'The assistant skipped the slow tests without saying so.', 'Focused chat')
const NO_HEAD = { ...stored('st-5', 7150.5, 'x', 'No headline here.'), points: [{ kind: 'cost', by: 'user', text: 'No headline here.' }] }
/** Mounts a registration's strip and one row per chat through its own contributions. */
function mountRun(c) {
  const sc = c.registered.find(x => x.area === 'composer.top')
  const dc = c.registered.find(x => x.area === 'sessionRow.trailing')
  const st = mount(createElement(sc.render))
  const RunRow = ({ sessionId }) => dc.data.render({ sessionId })
  const rs = Object.fromEntries(ROWS.map(id => [id, mount(createElement(RunRow, { sessionId: id }))]))
  return {
    strip: st,
    dots: () => Object.fromEntries(ROWS.map(id => [id, $$(rs[id].el, '[data-asterisk="dot"]').length])),
    heads: () => $$(st.el, '[data-asterisk="entry"]').map(e => text($(e, '[data-asterisk="headline"]'))),
    unmount: () => act(() => { st.root.unmount(); ROWS.forEach(id => rs[id].root.unmount()) }),
    emit: (session_id, payload) => act(async () => {
      for (const fn of c.listeners) fn({ type: 'message.complete', session_id, payload })
      await settle()
      await settle()
    })
  }
}
await focus('rt-4', 'st-4')
const petR = { visible: true, said: [] }
const r1 = fakeCtx(READY, { notes: { notes: [E2, NO_HEAD, E1] }, pet: { visible: { get: () => petR.visible }, say: (x, o) => { petR.said.push([x, o]) } } })
let toastsR = stub.calls.notify.length
await quietly(async () => {
  mod.default.register(r1.ctx)
  await settle()
  await settle()
})
let m = mountRun(r1)
let rs = $(m.strip.el, '[data-asterisk="strip"]')
let re = $$(m.strip.el, '[data-asterisk="entry"]')
check([E1, E2, NO_HEAD].every(e => same(Object.keys(e).sort(), KEYS14)) && same(r1.notes, [{ method: 'POST', body: {} }])
  && same(m.heads(), ['Restored first', 'Restored second']) && same($$(rs, '[data-asterisk="num"]').map(text), ['1', '2']) && rs?.getAttribute('data-folded') === 'false'
  && re[1]?.getAttribute('data-expanded') === 'true' && same(buttons(re[1]), FOCUSED5)
  && re[0]?.getAttribute('data-expanded') === 'false' && same(buttons(re[0]), ['Open']) && text($(re[0], '[data-asterisk="meta"]')) === 'Unstated tradeoff · Old chat · fake-model-x ~$0.02'
  && same(m.dots(), { 'st-1': 0, 'st-2': 0, 'st-3': 0, 'st-4': 1, 'st-5': 1 }) && petR.said.length === 0,
  `23e/24a. restart: /notes entries in the backend's shape show numbered in at order, the focused one expanded with [Already knew] [Not sure] [Not useful] [Ask in chat] [Got it], the right dots, no pet line, not folded (${m.heads()} | ${JSON.stringify(m.dots())} | ${petR.said.length} pet lines)`)
check(stub.calls.notify.length === toastsR && !m.heads().includes('x'), `23e. an entry without a headline is skipped with no toast (${stub.calls.notify.length - toastsR} toasts)`)
const insR = stub.calls.insert.length
await click(button(re[1], 'Ask in chat'))
check(stub.calls.insert.length === insR + 1 && same(stub.calls.insert.at(-1), ['st-4', `Asterisk: Restored second — ${E2.points[0].text}`, { mode: 'block' }])
  && same(r1.checks.at(-1), ['/dismiss', { method: 'POST', body: { check_at: 7200.5, signal: 'asked' } }]) && same(m.heads(), ['Restored first']),
  `23e. a restored note asks into its own chat and is dismissed with its stored at (${JSON.stringify(r1.checks.at(-1))})`)
m.unmount()
r1.disposers.forEach(fn => fn())

// 23e. /notes answers late: a live note it also holds shows once; a note dismissed meanwhile is not restored
const waiting2 = []
const release = answer => waiting2.splice(0).forEach(r => r(answer))
const r2 = fakeCtx(READY, { notes: () => new Promise(r => { waiting2.push(r) }) })
await quietly(async () => {
  mod.default.register(r2.ctx)
  await settle()
  await settle()
})
m = mountRun(r2)
const LIVE = 'The assistant kept the old schema without saying the migration was skipped.'
r2.checkAnswer = { points: [point('Live and stored', LIVE)], cost_usd: 0.0213, cost_status: 'estimated', model: 'fake-model-x', at: 7300.5, title: 'Focused chat' }
await m.emit('rt-4', frame('restart live', 300))
r2.checkAnswer = { points: [point('Dismissed early', 'The assistant pushed to main without saying so.')], cost_usd: 0.0213, cost_status: 'estimated', model: 'fake-model-x', at: 7400.5, title: 'Focused chat' }
await m.emit('rt-4', frame('restart dismissed', 310))
const liveHeads = m.heads()
await click(button($$(m.strip.el, '[data-asterisk="entry"]')[1], 'Got it'))
const dismissedR = same(r2.checks.at(-1), ['/dismiss', { method: 'POST', body: { check_at: 7400.5, signal: 'read' } }])
await click($(m.strip.el, '[data-asterisk="fold"]'))
await act(async () => {
  release({ notes: [stored('st-4', 7400.5, 'Dismissed early', 'The assistant pushed to main without saying so.', 'Focused chat'), stored('st-4', 7300.5, 'Live and stored', LIVE, 'Focused chat'), E1] })
  await settle()
  await settle()
})
rs = $(m.strip.el, '[data-asterisk="strip"]')
check(rs?.getAttribute('data-folded') === 'true' && text($(rs, '.asterisk-label-count')) === '· 2 notes',
  `23e. restored notes do not unfold a folded strip (${rs?.getAttribute('data-folded')}, ${text($(rs, '[data-asterisk="label"]'))})`)
await click($(m.strip.el, '[data-asterisk="fold"]'))
check(same(liveHeads, ['Live and stored', 'Dismissed early']) && dismissedR && r2.notes.length === 3 && r2.notes.every(x => same(x, { method: 'POST', body: {} }))
  && same(m.heads(), ['Restored first', 'Live and stored']) && same(m.dots(), { 'st-1': 0, 'st-2': 0, 'st-3': 0, 'st-4': 1, 'st-5': 1 }),
  `23e. a late /notes: the live note it also holds shows once, the note dismissed while it was pending is not restored (${liveHeads} -> ${m.heads()})`)
m.unmount()
r2.disposers.forEach(fn => fn())

// 23e. a failed /notes is one named error toast
const r3 = fakeCtx(READY, { notes: new Error('network down') })
toastsR = stub.calls.notify.length
await quietly(async () => {
  mod.default.register(r3.ctx)
  await settle()
  await settle()
})
const addedR = stub.calls.notify.slice(toastsR)
check(addedR.length === 1 && addedR[0].id === 'asterisk-restore-error' && addedR[0].kind === 'error' && addedR[0].title === 'Asterisk'
  && addedR[0].message === 'Could not restore earlier notes: network down' && r3.notes.length === 1,
  `23e. a failed /notes is one asterisk-restore-error toast with its copy (${JSON.stringify(addedR)})`)
r3.disposers.forEach(fn => fn())
check(reactWarnings.length === 0, `React logged no warning in the restart runs (${reactWarnings.slice(0, 2).join(' | ')})`)

// 25. the settings page (4.4.0): Settings → Plugins → Asterisk
const KINDS_P = ['irreversible', 'security', 'unanswered', 'overclaim', 'constraint', 'result', 'cost', 'tradeoff', 'assumption', 'overreach']
const GROUP_P = { irreversible: 1, security: 1, unanswered: 2, overclaim: 2, constraint: 2, result: 3, cost: 3, tradeoff: 4, assumption: 4, overreach: 4 }
const OUTCOMES_P = ['shown', 'filtered', 'asked', 'read', 'already_knew', 'unsure', 'not_useful', 'open', 'evicted', 'chat_gone', 'unrecorded']
const outc = (o = {}) => Object.fromEntries(OUTCOMES_P.map(k => [k, o[k] ?? 0]))
const SINCE = 1792500000
const REPORT = {
  settings: { tone: 'plain', enabled: KINDS_P.filter(k => k !== 'cost') },
  tones: ['plain', 'friendly', 'playful'],
  notes_max: 50,
  kinds: KINDS_P.map(k => ({ kind: k, group: GROUP_P[k], locked: k === 'irreversible' || k === 'security' })),
  since: SINCE,
  unreadable_lines: 0,
  totals: { checks: 12, notes: 5, spend_usd: 0.1, unpriced: 0, asked: 2, cost_per_asked_usd: 0.05, skips: { no_receipt: 2, short: 1 } },
  by_kind: [...KINDS_P.map(k => ({ key: k, checks_on: 12, ...outc(k === 'result' ? { shown: 4, asked: 2, not_useful: 2 } : {}) })),
    { key: 'other', checks_on: 0, ...outc({ shown: 1, unrecorded: 1 }) }],
  by_model: [{ key: 'm-a', checks: 11, spend_usd: 0.1, cost_per_asked_usd: 0.05, ...outc({ shown: 4, asked: 2, not_useful: 2 }) },
    { key: 'unknown', checks: 1, spend_usd: 0, cost_per_asked_usd: null, ...outc({ shown: 1, unrecorded: 1 }) }],
  by_tone: ['plain', 'friendly', 'playful'].map(k => ({ key: k, checks: k === 'plain' ? 12 : 0, spend_usd: k === 'plain' ? 0.1 : 0,
    cost_per_asked_usd: k === 'plain' ? 0.05 : null, ...outc(k === 'plain' ? { shown: 5, asked: 2 } : {}) })),
  suggestions: [{ kind: 'result', negative: 12, rated: 15 }]
}
const SUGGEST = 'Turn off Doubtful result? 12 of the last 15 rated notes were Not useful or Already knew. Turning it off stops Asterisk looking for it; you can turn it back on with its switch.'
const COLS_MODEL = ['Model', 'Checks', 'Spent', 'Per asked note', 'Shown', 'Asked', 'Got it', 'Already knew', 'Not sure', 'Not useful']
const COLS_KIND = ['Kind', 'Shown', 'Asked', 'Got it', 'Already knew', 'Not sure', 'Not useful', 'Open', 'Unrecorded']
/** One registration whose ctx answers the page's three routes through `answer(path, body)` (a promise, a value or an Error). */
function pageCtx(answer) {
  const c = { calls: [], pages: [], disposers: [] }
  c.ctx = {
    register: () => () => {},
    i18n: { register: () => {}, t: key => mod.t(key) },
    onEvent: () => () => {},
    onDispose: fn => { c.disposers.push(fn) },
    registerSettingsPage: p => { c.pages.push(p); return () => {} },
    rest: async (p, opts) => {
      if (p === '/status') return { ready: true, update_notice: false, old_install: false }
      if (p === '/notes') return { notes: [] }
      c.calls.push([p, opts])
      const a = await answer(p, opts?.body)
      if (a instanceof Error) throw a
      return a
    }
  }
  return c
}
const echo = (p, body) => (p === '/settings' ? { ...REPORT, settings: { tone: body.tone, enabled: body.enabled } } : p === '/keep' ? { ...REPORT, suggestions: [] } : REPORT)
const flush = () => act(async () => { await settle(); await settle() })
let pageAnswer = echo
const pc = pageCtx((p, body) => pageAnswer(p, body))
await quietly(async () => {
  mod.default.register(pc.ctx)
  await settle()
  await settle()
})
check(pages.length === 1 && pages[0].id === 'settings' && pages[0].title === 'Asterisk' && pages[0].icon === 'eye' && typeof pages[0].render === 'function'
  && registered.length === 2 && pc.pages.length === 1,
  `25. registration adds exactly one settings page: id settings, title Asterisk, icon eye, a render function; the two contributions unchanged (${JSON.stringify(pages.map(p => [p.id, p.title]))})`)
let releasePage
pageAnswer = () => new Promise(r => { releasePage = r })
const pg = mount(createElement(pc.pages[0].render))
await flush()
const root = () => $(pg.el, '[data-asterisk="settings"]')
check(text($(pg.el, '[data-asterisk="loading"]')) === 'Loading…' && same(pc.calls, [['/report', { method: 'POST', body: {} }]]),
  `25. mounting the page sends exactly ['/report', { method: 'POST', body: {} }] and shows Loading… (${JSON.stringify(pc.calls)})`)
await act(async () => { releasePage(REPORT); await settle(); await settle() })
pageAnswer = echo
const sections = ['kinds', 'tone', 'report'].map(n => $(pg.el, `section[data-asterisk="${n}"]`))
check(root()?.className === 'asterisk-settings' && sections.every(s => s && $(s, 'h2'))
  && same(sections.map(s => text($(s, 'h2'))), ['What it looks for', 'How it talks', 'How useful it is']),
  `25. the page root holds the three sections, each with its h2 (${sections.map(s => text($(s, 'h2')))})`)
const kindRows = () => $$(pg.el, '[data-asterisk="kind-row"]')
const switchOf = k => $(pg.el, `[data-asterisk="kind-row"][data-kind="${k}"] .asterisk-switch`)
check(same(kindRows().map(r => r.getAttribute('data-kind')), KINDS_P)
  && same($$(pg.el, '[data-asterisk="group"]').map(text), ['Priority 1', 'Priority 2', 'Priority 3', 'Priority 4'])
  && text($(kindRows()[0], '.asterisk-kind-label')) === 'Irreversible step'
  && text($(kindRows()[0], '.asterisk-kind-desc')) === 'A step that deleted, overwrote or published something, which the reply plays down.',
  `25. ten kind rows in PRIORITY order under Priority 1 to 4, with label and description (${kindRows().map(r => r.getAttribute('data-kind'))})`)
const locked = $$(pg.el, '.asterisk-switch').filter(b => b.disabled)
check($$(pg.el, '.asterisk-switch').every(b => b.getAttribute('role') === 'switch' && b.getAttribute('type') === 'button')
  && same(locked.map(b => b.closest('[data-asterisk="kind-row"]').getAttribute('data-kind')), ['irreversible', 'security'])
  && locked.every(b => b.getAttribute('aria-checked') === 'true') && switchOf('cost').getAttribute('aria-checked') === 'false'
  && switchOf('tradeoff').getAttribute('aria-checked') === 'true'
  && $$(pg.el, '[data-asterisk="locked"]').length === 1 && text($(pg.el, '[data-asterisk="locked"]')) === 'Always on: a missed irreversible step or security risk costs the most.'
  && $(pg.el, '[data-asterisk="locked"]').previousElementSibling?.textContent === 'Priority 1'
  && locked.every(b => b.getAttribute('aria-describedby') === $(pg.el, '[data-asterisk="locked"]').id && b.getAttribute('data-locked') === 'true'),
  `25/26. the two locked switches are disabled and checked; their reason is said once, under Priority 1, and describes both; cost off, tradeoff on (${locked.length} disabled)`)
const radios = () => $$(pg.el, '[role="radiogroup"] [role="radio"]')
check(radios().length === 3 && same(radios().map(r => text($(r, '.asterisk-tone-label'))), ['Plain', 'Friendly', 'Playful'])
  && same(radios().map(r => r.getAttribute('aria-checked')), ['true', 'false', 'false']) && radios().every(r => r.classList.contains('asterisk-tone')),
  `25. three tone radios Plain, Friendly, Playful; the saved one is checked (${radios().map(r => r.getAttribute('aria-checked'))})`)
const tables = ['by-kind', 'by-model', 'by-tone'].map(n => $(pg.el, `table[data-asterisk="${n}"]`))
check(tables.every(Boolean) && same($$(tables[1], 'th').map(text), COLS_MODEL) && same($$(tables[0], 'th').map(text), COLS_KIND) && $$(tables[0], 'tbody tr').length === 11
  && $$(tables[1], 'tbody td:first-child').every(td => td.className === 'asterisk-key-model' && td.getAttribute('title') === text(td))
  && text($$(tables[0], 'tbody tr')[10].children[0]) === 'Older kinds' && same($$(tables[2], 'tbody tr').map(r => text(r.children[0])), ['Plain', 'Friendly', 'Playful'])
  && text($$(tables[1], 'tbody tr')[1].children[0]) === 'Unknown model' && text($$(tables[1], 'tbody tr')[1].children[3]) === '–',
  `25/26. the three tables render: kind with the common outcomes and only the rare ones some row has (Unrecorded here), model and tone with money and rated columns, model ids titled (${$$(tables[0], 'th').map(text)} | ${$$(tables[1], 'th').map(text)})`)
const sug = () => $$(pg.el, '[data-asterisk="suggestion"]')
check(sug().length === 1 && sug()[0].getAttribute('data-kind') === 'result' && text($(sug()[0], '.asterisk-suggest-text')) === SUGGEST
  && sug()[0].parentElement === $(pg.el, '[data-asterisk="kind-row"][data-kind="result"]') && !$(pg.el, 'section[data-asterisk="report"] [data-asterisk="suggestion"]')
  && same($$(sug()[0], 'button').map(text), ['Turn off', 'Keep']) && $$(sug()[0], 'button').every(b => b.className === 'asterisk-suggest-btn'),
  `25/26. the suggestion sits in its kind's row, names the kind with its counts and offers Turn off and Keep (${text(sug()[0])})`)
const sinceDate = new Date(SINCE * 1000).toISOString().slice(0, 10)
check(text($(pg.el, '[data-asterisk="summary"]')) === `12 checks · 5 notes · $0.10 spent · $0.05 per asked note · 3 skipped · since ${sinceDate}`
  && same($$(pg.el, '[data-asterisk="legend"] li').map(text), ['Unrecorded: from a version that did not record how a note left.']),
  `25/26. the summary line, and a legend only for the rare columns shown (${text($(pg.el, '[data-asterisk="summary"]'))} | ${$$(pg.el, '[data-asterisk="legend"] li').map(text)})`)
const before25 = pc.calls.length
await click(switchOf('security'))
check(pc.calls.length === before25, '25. a locked switch click sends nothing')
let releaseSave
pageAnswer = (p, body) => new Promise(r => { releaseSave = () => r(echo(p, body)) })
await click(switchOf('tradeoff'))
const controls = () => [...$$(pg.el, '.asterisk-switch'), ...radios(), ...$$(pg.el, '.asterisk-suggest-btn')]
check(same(pc.calls.at(-1), ['/settings', { method: 'POST', body: { tone: 'plain', enabled: REPORT.settings.enabled.filter(k => k !== 'tradeoff') } }])
  && controls().every(b => b.getAttribute('aria-disabled') === 'true' || b.getAttribute('data-locked') === 'true') && controls().filter(b => b.disabled).length === 2
  && text($(pg.el, '[data-asterisk="saving"]')) === 'Saving…' && $(pg.el, '[data-asterisk="saving"]').getAttribute('role') === 'status',
  `25/26. a switch click sends /settings with the full list minus that kind; while it is pending every control is aria-disabled (still focusable) and "Saving…" shows (${JSON.stringify(pc.calls.at(-1))})`)
const pendingCalls = pc.calls.length
await clickHeld(radios()[2])
check(pc.calls.length === pendingCalls, '26. a click while a save is pending sends nothing')
await act(async () => { releaseSave(); await settle(); await settle() })
pageAnswer = echo
check(switchOf('tradeoff').getAttribute('aria-checked') === 'false' && !switchOf('tradeoff').disabled && !switchOf('tradeoff').hasAttribute('aria-disabled')
  && text($(pg.el, '[data-asterisk="saving"]')) === '', '25. the answer redraws the page: tradeoff off, controls enabled again, no "Saving…"')
await click(radios()[1])
check(same(pc.calls.at(-1), ['/settings', { method: 'POST', body: { tone: 'friendly', enabled: REPORT.settings.enabled.filter(k => k !== 'tradeoff') } }])
  && radios()[1].getAttribute('aria-checked') === 'true',
  `25. a tone click sends /settings with that tone and the current kinds (${JSON.stringify(pc.calls.at(-1))})`)
check(same(radios().map(r => r.tabIndex), [-1, 0, -1]) && same(radios().map(r => Boolean($(r, '.asterisk-tone-check'))), [false, true, false])
  && $(radios()[1], '.asterisk-tone-check')?.getAttribute('aria-hidden') === 'true',
  `26. only the checked tone is in the tab order and carries the hidden check mark (${radios().map(r => r.tabIndex)})`)
await act(async () => { radios()[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await settle(); await settle() })
check(pc.calls.at(-1)?.[1]?.body?.tone === 'playful' && radios()[2].getAttribute('aria-checked') === 'true' && document.activeElement === radios()[2],
  `26. ArrowDown in the tone group selects and focuses the next tone (${pc.calls.at(-1)?.[1]?.body?.tone})`)
await act(async () => { radios()[2].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await settle(); await settle() })
check(pc.calls.at(-1)?.[1]?.body?.tone === 'plain' && document.activeElement === radios()[0], '26. ArrowRight on the last tone wraps to the first')
await act(async () => { radios()[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); await settle(); await settle() })
check(pc.calls.at(-1)?.[1]?.body?.tone === 'playful', '26. ArrowUp on the first tone wraps to the last')
await click(radios()[1])
await click($(sug()[0], '[data-asterisk="turn-off"]'))
check(same(pc.calls.at(-1)?.[1]?.body?.enabled, REPORT.settings.enabled.filter(k => k !== 'tradeoff' && k !== 'result')) && pc.calls.at(-1)[1].body.tone === 'friendly',
  `25. Turn off sends /settings without the kind, the tone unchanged (${JSON.stringify(pc.calls.at(-1))})`)
await click($(sug()[0], '[data-asterisk="keep"]'))
check(same(pc.calls.at(-1), ['/keep', { method: 'POST', body: { kind: 'result' } }]) && sug().length === 0,
  `25. Keep sends /keep { kind } and the answer has no suggestion (${JSON.stringify(pc.calls.at(-1))})`)
pageAnswer = p => (p === '/settings' ? new Error('disk full') : echo(p))
const toastsS = stub.calls.notify.length
await quietly(() => click(switchOf('assumption')))
const addedS = stub.calls.notify.slice(toastsS)
check(addedS.length === 1 && addedS[0].id === 'asterisk-settings-error' && addedS[0].kind === 'error' && addedS[0].title === 'Asterisk'
  && addedS[0].message === 'Could not save the settings: disk full' && kindRows().length === 10 && switchOf('assumption').getAttribute('aria-checked') === 'true'
  && !switchOf('assumption').disabled,
  `25. a failed save is one asterisk-settings-error notice and the page keeps the last report (${JSON.stringify(addedS)})`)
pageAnswer = echo
const vars25 = [...(text($(pg.el, 'style')).matchAll(/var\(\s*(--[\w-]+)/g))].map(x => x[1])
const css25 = text($(pg.el, 'style'))
SETTINGS_TEXT = css25
const rules25 = [...css25.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(x => ({ sel: x[1].trim(), body: x[2] }))
const moving25 = rules25.filter(r => /(^|;)\s*(transition|animation)\s*:/.test(r.body))
check(vars25.length > 10 && vars25.every(v => v.startsWith('--ui-') || v.startsWith('--font-'))
  && !/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(|:\s*(?:white|black)\b/i.test(css25),
  `25. the page CSS names only --ui-* and --font-* tokens and no literal colour (${[...new Set(vars25)].length} tokens)`)
check(/\.asterisk-settings\{[^}]*container-type:inline-size/.test(css25) && css25.includes('@container asterisk-settings') && !css25.includes('@media'),
  '25. the page root is an inline-size container, the narrow layout is an @container asterisk-settings rule, and there is no @media')
check(moving25.length >= 1 && moving25.every(r => r.sel.includes('[data-motion="full"]')) && root()?.getAttribute('data-motion') === 'full',
  `25. every transition or animation selector includes [data-motion="full"] (${moving25.map(r => r.sel)})`)
const texts25 = []
const collect25 = el => {
  texts25.push(el.textContent)
  for (const n of el.querySelectorAll('*')) for (const a of ['aria-label', 'title', 'data-label']) if (n.getAttribute(a)) texts25.push(n.getAttribute(a))
}
collect25(root())
check(texts25.length > 10 && !texts25.some(x => x.replace(css25, '').includes('*') || GLYPHS.test(x)) && !texts25.some(x => x.replace(css25, '').includes('asterisk.')),
  `25. no rendered page text or attribute has an asterisk, a glyph or a raw key (${texts25.length} strings)`)
act(() => pg.root.unmount())
reduce = true
const pgR = mount(createElement(pc.pages[0].render))
await flush()
check($(pgR.el, '[data-asterisk="settings"]')?.getAttribute('data-motion') === 'reduce', '25. reduced motion -> data-motion="reduce" on the page')
act(() => pgR.root.unmount())
reduce = false
pageAnswer = p => (p === '/report' ? new Error('network down') : echo(p))
const pe = mount(createElement(pc.pages[0].render))
await quietly(flush)
const reportCalls = () => pc.calls.filter(x => x[0] === '/report').length
const reportsBefore = reportCalls()
check(text($(pe.el, '[data-asterisk="load-error"] p')) === 'Could not load the report: network down' && text($(pe.el, '[data-asterisk="retry"]')) === 'Try again',
  `25. a failed load shows its error and Try again (${text($(pe.el, '[data-asterisk="load-error"]'))})`)
pageAnswer = () => ({ ...REPORT, totals: { ...REPORT.totals, checks: 0 }, suggestions: [] })
await click($(pe.el, '[data-asterisk="retry"]'))
await flush()
check(reportCalls() === reportsBefore + 1 && $$(pe.el, 'section').length === 3 && text($(pe.el, '[data-asterisk="empty"]')) === 'No checks recorded yet.',
  `25. Try again re-sends /report; a report with no checks says No checks recorded yet. (${reportCalls() - reportsBefore} re-sent)`)
act(() => pe.root.unmount())
pc.disposers.forEach(fn => fn())
check(reactWarnings.length === 0, `25. React logged no warning on the settings page (${reactWarnings.slice(0, 2).join(' | ')})`)

// 27. a chat deleted while the app runs (4.6.1): sessions.changed asks /notes and drops that chat's notes
const changed = () => act(async () => {
  for (const fn of listeners.get('sessions.changed') || []) fn({ type: 'sessions.changed', payload: {} })
  await settle()
  await settle()
})
const heads27 = () => $$(strip.el, '[data-asterisk="entry"]').map(e => text($(e, '[data-asterisk="headline"]')))
let notes27 = notesCalls.length
await changed()
check(notesCalls.length === notes27, '27. with no note and no undo window, sessions.changed asks nothing')
notesAnswer = { notes: [], gone: [] }
await focus('rt-1', 'st-1')
reply = { points: [point('Kept chat note', 'The assistant kept the old flag without saying so.')], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 8400.5, title: null }
await emit('rt-1', frame('prune one', 840))
await focus('rt-2', 'st-2')
reply = { points: [point('Deleted chat note', 'The assistant removed the hook without saying so.')], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 8410.5, title: null }
await emit('rt-2', frame('prune two', 841))
notes27 = notesCalls.length
const rest27 = rest.length
const toasts27 = stub.calls.notify.length
notesAnswer = { notes: [], gone: [] }
await changed()
check(notesCalls.length === notes27 + 1 && same(notesCalls.at(-1), { method: 'POST', body: {} }) && same(heads27(), ['Kept chat note', 'Deleted chat note']),
  `27. with notes pending, sessions.changed posts /notes {}; nothing gone keeps every note (${heads27()})`)
notesAnswer = { notes: [], gone: ['st-2', 'st-9'] }
await changed()
check(same(heads27(), ['Kept chat note']) && dots()['st-2'] === 0 && dots()['st-1'] === 1 && rest.length === rest27 && stub.calls.notify.length === toasts27,
  `27. a gone chat's note leaves the strip and its dot goes; the other chat's note stays; nothing is posted or toasted (${heads27()}, ${JSON.stringify(dots())})`)
await clickHeld(button(strip.el, 'Not sure'))
notesAnswer = { notes: [], gone: ['st-1'] }
await changed()
check(stripGone() && held.size === 0 && rest.length === rest27, `27. a held rating of a gone chat's note is dropped with its undo row, unposted (${held.size} held)`)
await elapse()
check(rest.length === rest27, '27. the closed window posts nothing for the gone chat')
notesAnswer = { notes: [], gone: [] }
reply = { points: [point('Prune coalesced', 'The assistant left the lock in place without saying so.')], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 8420.5, title: null }
await emit('rt-2', frame('prune three', 842))
let release27
notesAnswer = () => new Promise(r => { release27 = () => r({ notes: [], gone: [] }) })
notes27 = notesCalls.length
await changed()
await changed()
await changed()
const inFlight27 = notesCalls.length - notes27
notesAnswer = { notes: [], gone: ['st-2'] }
await act(async () => { release27(); await settle(); await settle(); await settle() })
check(inFlight27 === 1 && notesCalls.length === notes27 + 2 && stripGone(),
  `27. changes while /notes is pending send one trailing /notes, not one each; its answer still prunes (${inFlight27} in flight, ${notesCalls.length - notes27} total)`)
notesAnswer = { notes: [], gone: [] }
reply = { points: [point('Prune failure', 'The assistant kept the retry loop without saying so.')], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 8430.5, title: null }
await emit('rt-2', frame('prune four', 843))
notesAnswer = new Error('network down')
await quietly(changed)
check(same(heads27(), ['Prune failure']) && stub.calls.notify.length === toasts27, '27. a failed /notes keeps the notes and shows no toast')
notesAnswer = { notes: [], gone: ['st-2'] }
await changed()
check(stripGone(), '27. the next change drops it')
notes27 = notesCalls.length
reply = { points: [point('Checked while deleted', 'The assistant kept the branch without saying so.')], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 8440.5, title: null }
await emit('rt-2', frame('prune five', 844))
check(notesCalls.length === notes27 + 1 && stripGone() && dots()['st-2'] === 0,
  `27. a note whose chat was deleted while its check ran is dropped right after it lands: each new note asks /notes once (${notesCalls.length - notes27})`)
notesAnswer = { notes: [] }

// 26. the 4.6.0 interface pass: undo, kind and severity, keys, sizes
await focus('rt-1', 'st-1')
const live26 = text(live())
reply = { points: [point('Undo first', 'The assistant kept the cache without saying it is stale.')], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 8100.5, title: null }
await emit('rt-1', frame('undo one', 810))
reply = { points: [point('Undo second', 'The assistant dropped the index without saying queries slow down.', 'assistant', 'security')], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 8200.5, title: null }
await emit('rt-1', frame('undo two', 820))
const heads26 = () => $$(strip.el, '[data-asterisk="entry"]').map(e => text($(e, '[data-asterisk="headline"]')))
check(same(heads26(), ['Undo first', 'Undo second']) && text(live()) === 'Worth knowing: Undo second' && live26 !== text(live()),
  `26. each live note replaces the hidden live line's text with its own headline (${text(live())})`)
let posts26 = rest.length
await clickHeld(button($$(strip.el, '[data-asterisk="entry"]')[0], 'Not useful'))
let undoRow = $(strip.el, '[data-asterisk="undo"]')
check(rest.length === posts26 && same(heads26(), ['Undo second']) && text($(undoRow, 'span')) === 'Recorded: Not useful.' && same($$(undoRow, 'button').map(text), ['Undo']) && held.size === 1,
  `26. a rating click removes the note at once, posts nothing yet and offers "Recorded: Not useful." with Undo (${rest.length - posts26} posts, ${text(undoRow)})`)
await clickHeld(button(undoRow, 'Undo'))
check(rest.length === posts26 && same(heads26(), ['Undo first', 'Undo second']) && !$(strip.el, '[data-asterisk="undo"]') && held.size === 0 && dots()['st-1'] === 1,
  `26. Undo puts the note back in its place, posts nothing and clears the window (${heads26()})`)
await elapse()
check(rest.length === posts26, '26. after Undo the closed window posts nothing')
await clickHeld(button($$(strip.el, '[data-asterisk="entry"]')[0], 'Already knew'))
await clickHeld(button($$(strip.el, '[data-asterisk="entry"]')[0], 'Got it'))
check(rest.length === posts26 + 1 && same(rest.at(-1), ['/dismiss', { method: 'POST', body: { check_at: 8100.5, signal: 'already_knew' } }])
  && text($(strip.el, '[data-asterisk="undo"] span')) === 'Recorded: Got it.' && held.size === 1 && !$(strip.el, '[data-asterisk="entry"]') && dots()['st-1'] === 0,
  `26. a second click closes the first window at once (its signal posted) and opens its own; the last note gone, only the undo row stays (${JSON.stringify(rest.at(-1))})`)
await elapse()
check(rest.length === posts26 + 2 && same(rest.at(-1), ['/dismiss', { method: 'POST', body: { check_at: 8200.5, signal: 'read' } }]) && stripGone(),
  `26. the window closing posts the held signal, and the strip is gone (${JSON.stringify(rest.at(-1))})`)
reply = { points: [point('Escape folds', 'The assistant skipped the migration without saying so.', 'assistant', 'irreversible')], cost_usd: 0.01, cost_status: 'estimated', model: 'fake-model-x', at: 8300.5, title: null }
await emit('rt-1', frame('escape', 830))
posts26 = rest.length
s = $(strip.el, '[data-asterisk="strip"]')
check(text($(s, '[data-asterisk="label"]')) === 'Worth knowing · Irreversible step' && $(s, '[data-asterisk="label"] [data-asterisk="kind"]')?.getAttribute('data-severity') === 'high'
  && $(s, '[data-asterisk="entry"]')?.getAttribute('data-severity') === 'high',
  `26. an irreversible note: the label names the kind and marks it high (${text($(s, '[data-asterisk="label"]'))})`)
await act(async () => { button(s, 'Got it').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle() })
s = $(strip.el, '[data-asterisk="strip"]')
check(s?.getAttribute('data-folded') === 'true' && rest.length === posts26, `26. Escape inside the strip folds it and records nothing (${s?.getAttribute('data-folded')}, ${rest.length - posts26})`)
await click($(s, '[data-asterisk="fold"]'))
await clickHeld(button(strip.el, 'Got it'))
const postsDispose = rest.length
const css26 = text($(strip.el, 'style'))
const sizes = css => [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map(x => +x[1])
const rule = (css, sel) => css.match(new RegExp(`(^|\\n|\\})${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`))?.[2] || ''
check(sizes(css26).length > 8 && sizes(css26).every(n => n >= 12) && sizes(SETTINGS_TEXT).every(n => n >= 12)
  && /min-height:24px/.test(rule(css26, '.asterisk-btn')) && /min-width:24px/.test(rule(css26, '.asterisk-fold')) && /min-height:24px/.test(rule(css26, '.asterisk-fold'))
  && /stroke:var\(--ui-red\)/.test(rule(css26, '.asterisk-entry[data-severity="high"] .asterisk-stroke path'))
  && /animation:none/.test(rule(css26, '[data-motion="full"] .asterisk-entry[data-severity="high"] .asterisk-stroke path'))
  && /\[data-motion="full"\] \.asterisk-entry\[data-expanded="true"\] \.asterisk-stroke path\{[^}]*animation:asterisk-draw/.test(css26)
  && !/border-left:\s*[2-9]/.test(css26 + SETTINGS_TEXT),
  `26. CSS: no text under 12px, 24px targets, a high note's stroke in --ui-red drawn without animation, only an expanded note's stroke draws, no thick side border (${Math.min(...sizes(css26))}px)`)
// 1. dispose
disposers.forEach(fn => fn())
check(rest.length === postsDispose + 1 && same(rest.at(-1)?.[1]?.body, { check_at: 8300.5, signal: 'read' }) && held.size === 0,
  `26. dispose closes an open undo window and posts its signal (${JSON.stringify(rest.at(-1))})`)
check(stub.host.state.focusedSessionId.subs.size === 0 && stub.host.state.focusedStoredSessionId.subs.size === 0, 'dispose retires the focus listeners')
act(() => { strip.root.unmount(); ROWS.forEach(id => rows[id].root.unmount()) })
console.error = consoleError

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
process.exitCode = failures ? 1 : 0
