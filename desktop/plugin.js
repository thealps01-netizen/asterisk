/**
 * Asterisk — names the one thing a reply did not plainly tell the user, if there is one.
 *
 * When a reply of a chat the user has opened in this app finishes (`message.complete`, status
 * complete, a new reply), the plugin sends the backend that chat's stored id and the frame's
 * `persisted_turn` receipt (the turn's committed row ids); the backend alone decides whether the
 * turn is checked (a tool that may change something, or a long reply) or skipped. It reads that
 * whole turn — the user's message, the assistant's tool calls and their results, the final reply —
 * and a second model (the one chosen for Asterisk in Settings → Models) returns one point or none: an unstated tradeoff, a result that may be
 * off, a silent assumption, an understated irreversible step, a security risk, a cost, a request left
 * unanswered, work claimed but not done, a step the user ruled out or one nobody asked for, saying who
 * decided it (the assistant or the user), as a short headline and one sentence. Nothing to flag ->
 * nothing shown (the normal case).
 *
 * A point becomes a note in the "Worth knowing" strip at the top of the composer (`composer.top`):
 * the headline in a serif, underlined by a stroke in the theme's accent; with several notes, a
 * numbered list in arrival order. A note of the focused chat (or the only note) shows its sentence,
 * the check's cost and who decided, and "Already knew" / "Not sure" / "Not useful" / "Got it", plus
 * "Ask in chat" for the focused chat's note (it puts the note into that chat's input through
 * host.composer.insertText, never sends) or "Open" for another chat's; a note of another chat is
 * otherwise one line with that chat's title and "Open". A chevron folds the strip to its label; a new
 * note unfolds it. A note stays until one of the five buttons removes it, and each removal is recorded
 * (POST /dismiss with asked, read, already_knew, unsure or not_useful, no text). The sidebar row of a
 * chat with a pending note carries a dot in the accent (`sessionRow.trailing`). For the development
 * phase the backend keeps the pending notes, and they are restored (POST /notes) after a restart.
 * With a Hermes pet on screen it also says so in its bubble. Reduced motion: no stroke drawing and no
 * stagger.
 *
 * Each reply is checked once. A failed check is one error notice, named, never swallowed. The
 * plugin stores nothing of its own: the backend keeps a cost ledger with no text in it and the
 * pending notes (see Docs/asterisk-notes.md). Colours and type come from the app's theme tokens only.
 *
 * Asterisk runs only where it can: on an app whose plugin SDK lacks a name it uses it registers
 * nothing and asks the backend (POST /status) whether to show the one "update Hermes" notice; on a
 * current app it asks /status once after registering and stops checking when the backend says the
 * core is too old or the 2.x package is still installed (one notice each). A failed /status changes
 * nothing.
 */
// A namespace import links on any core: the SDK shim exports only the names it has, and a named
// import of a missing one fails the whole module before register() can say why.
import * as sdk from '@hermes/plugin-sdk'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { useEffect } from 'react'

const { atom, COMPOSER_AREAS, host, SESSION_ROW_AREAS, usePluginI18n, useValue } = sdk
const ID = 'asterisk'
const SEEN_MAX = 500
const CHECKED_MAX = 300
const STAGGER_MS = 80
const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif'

const en = {
  asterisk: {
    title: 'Asterisk',
    label: 'Worth knowing',
    count: n => (n === 1 ? '1 note' : `${n} notes`),
    meta: (cost, by, title, model) => [title, model, cost, by].filter(Boolean).join(' · '),
    from: (title, cost, model) => [title, [model, cost].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
    untitled: 'Untitled chat',
    by: {
      assistant: 'decided by assistant',
      user: 'decided by you'
    },
    open: 'Open',
    askInChat: 'Ask in chat',
    askText: (headline, text) => `Asterisk: ${headline} — ${text}`,
    askFailed: "Could not put the note into this chat's input. Click into the input and try again.",
    knew: 'Already knew',
    notSure: 'Not sure',
    notUseful: 'Not useful',
    gotIt: 'Got it',
    collapse: 'Collapse',
    expand: 'Expand',
    dotLabel: 'Worth knowing: a note waiting',
    failed: detail => `Could not check a reply: ${detail}`,
    noHeadline: 'the answer has no headline',
    feedbackFailed: (label, detail) => `Could not record "${label}": ${detail}`,
    restoreFailed: detail => `Could not restore earlier notes: ${detail}`,
    noNotes: 'the answer has no notes list',
    pet: 'Worth knowing: a note above the input',
    updateHermes: 'Asterisk needs Hermes v0.21.6 or later and stays off until then. Update Hermes, then reopen the app.',
    oldInstall: 'The old "you-should-know" plugin is still installed, so Asterisk stays off and no reply is checked twice. Uninstall it in Capabilities → Plugins, then reopen the app.',
    noModel: 'Asterisk has no model chosen, so it checks no reply. It does not use your main model on its own. Choose one in Settings → Models → Auxiliary models → Asterisk (Change, or Set to main).',
    settings: {
      kindsTitle: 'What it looks for',
      toneTitle: 'How it talks',
      reportTitle: 'How useful it is',
      group: n => `Priority ${n}`,
      locked: 'Always on: a missed irreversible step or security risk costs the most.',
      order: 'When a turn has more than one, the note names the first group that applies. The order is fixed.',
      toneNote: 'Tone changes only the headline: the sentence stays plain and you get the same notes. Irreversible and security notes are always written plainly.',
      loading: 'Loading…',
      loadFailed: detail => `Could not load the report: ${detail}`,
      retry: 'Try again',
      saveFailed: detail => `Could not save the settings: ${detail}`,
      noReport: 'the answer is not a report',
      empty: 'No checks recorded yet.',
      checks: n => (n === 1 ? '1 check' : `${n} checks`),
      notes: n => (n === 1 ? '1 note' : `${n} notes`),
      spent: usd => `${usd} spent`,
      perAsked: usd => `${usd} per asked note`,
      skipped: n => `${n} skipped`,
      since: date => `since ${date}`,
      suggest: (label, negative, rated) => `Turn off ${label}? ${negative} of the last ${rated} rated notes were Not useful or Already knew. Turning it off stops Asterisk looking for it; you can turn it back on above.`,
      turnOff: 'Turn off',
      keep: 'Keep',
      byKind: 'By kind',
      byModel: 'By model',
      byTone: 'By tone',
      kindCol: 'Kind',
      modelCol: 'Model',
      toneCol: 'Tone',
      other: 'Older kinds',
      unknownModel: 'Unknown model',
      none: '–',
      cols: {
        shown: 'Shown',
        filtered: 'Filtered',
        asked: 'Asked',
        read: 'Read',
        already_knew: 'Already knew',
        unsure: 'Not sure',
        not_useful: 'Not useful',
        open: 'Open',
        evicted: 'Dropped',
        chat_gone: 'Chat deleted',
        unrecorded: 'Unrecorded',
        checks: 'Checks',
        spend_usd: 'Spent',
        cost_per_asked_usd: 'Per asked note'
      },
      legendFiltered: 'Filtered: written by the model for a kind you switched off; not shown.',
      legendDropped: n => `Dropped: left when more than ${n} notes were waiting.`,
      legendUnrecorded: 'Unrecorded: from a version that did not record how a note left.',
      kinds: {
        irreversible: { label: 'Irreversible step', description: 'A step that deleted, overwrote or published something, which the reply plays down.' },
        security: { label: 'Security risk', description: 'A secret, a permission or an exposure the reply does not mention.' },
        unanswered: { label: 'Left unanswered', description: 'Something you asked for that the reply neither did nor said it skipped.' },
        overclaim: { label: 'Claimed, not done', description: 'Work the reply says was done (read, ran, tested) that the turn shows was not.' },
        constraint: { label: 'Against your instruction', description: 'Something you said not to do that the assistant did anyway.' },
        result: { label: 'Doubtful result', description: 'A result or value the reply presents as right that the tool results put in doubt.' },
        cost: { label: 'Money spent', description: 'Money spent or committed that the reply does not mention.' },
        tradeoff: { label: 'Unstated tradeoff', description: 'A choice the assistant made without saying what was given up.' },
        assumption: { label: 'Silent assumption', description: 'Something assumed without saying that changes the result.' },
        overreach: { label: 'Not asked for', description: 'Something the assistant did that you did not ask for.' }
      },
      tones: {
        plain: { label: 'Plain', description: 'Straight and neutral. The default.' },
        friendly: { label: 'Friendly', description: 'A warm headline, like a helpful colleague.' },
        playful: { label: 'Playful', description: 'A joke in the headline; the sentence and Ask in chat stay serious.' }
      }
    }
  }
}

/** The bundle's text for a key, with arguments; the raw key never reaches the screen. */
export function t(key, ...args) {
  let node = en
  for (const part of key.split('.')) node = node?.[part]
  return typeof node === 'function' ? node(...args) : typeof node === 'string' ? node : key
}

/** Hermes' recorded cost as text: '~$0.02' estimated, '<$0.01' under a cent, '' when unpriced. */
export function fmtCost(usd, status) {
  if (status === 'included') return 'subscription'
  if ((status !== 'estimated' && status !== 'actual') || typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return ''
  if (usd > 0 && usd < 0.005) return '<$0.01'
  return status === 'estimated' ? `~$${usd.toFixed(2)}` : `$${usd.toFixed(2)}`
}

/** A key for one reply over its WHOLE text (FNV-1a plus the length), so a reply is checked once. */
export function replyKey(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${text.length}:${h.toString(16)}`
}

/** Whether a message.complete frame is a reply the backend should see: complete and new. */
export function eligible(payload) {
  const p = payload || {}
  return p.status === 'complete' && !p.response_reused && typeof p.text === 'string'
}

const filled = v => typeof v === 'string' && v.trim() !== ''

/** The note for a check's answer; null when there is nothing to flag. A point it cannot show throws. */
export function noteFor(result, { key, storedId }) {
  const point = Array.isArray(result?.points) ? result.points[0] : undefined
  if (!point) return null
  if (!filled(point.headline) || !filled(point.text)) throw new Error(t('asterisk.noHeadline'))
  return {
    id: `${ID}-${key}`,
    storedId,
    title: filled(result.title) ? result.title : null,
    headline: point.headline,
    text: point.text,
    by: point.by,
    kind: point.kind,
    tone: result.tone,
    cost: fmtCost(result.cost_usd, result.cost_status),
    model: filled(result.model) ? result.model : '',
    checkAt: result.at
  }
}

/** Remember a value under a key, dropping the oldest entries past `max`. */
function remember(map, k, v, max) {
  map.delete(k)
  map.set(k, v)
  while (map.size > max) map.delete(map.keys().next().value)
}

/** Whether this app's plugin SDK has every name the plugin uses (Hermes v0.21.6 and later). */
export function desktopReady(api = sdk) {
  const h = api.host
  return api.COMPOSER_AREAS?.top === 'composer.top' && api.SESSION_ROW_AREAS?.trailing === 'sessionRow.trailing'
    && [api.atom, api.useValue, api.usePluginI18n].every(f => typeof f === 'function')
    && Boolean(h?.state?.focusedSessionId && h.state.focusedStoredSessionId)
    && typeof h.notify === 'function' && typeof h.openSession === 'function' && typeof h.composer?.insertText === 'function'
}

/** The one "update Hermes" notice, when the backend says this is the first time to show it. */
function tellUpdate(hostApi, answer) {
  if (answer?.update_notice === true && typeof hostApi?.notify === 'function') {
    hostApi.notify({ id: `${ID}-update-hermes`, kind: 'warning', title: t('asterisk.title'), message: t('asterisk.updateHermes') })
  }
}

const isStatus = a => Boolean(a) && typeof a === 'object' && ['ready', 'update_notice', 'old_install'].every(k => typeof a[k] === 'boolean')

/** An app too old for the plugin: nothing is registered; the backend remembers whether the notice was shown. */
async function standDown(ctx) {
  if (typeof ctx?.rest !== 'function') return
  try {
    tellUpdate(sdk.host, await ctx.rest('/status', { method: 'POST', body: { desktop_ready: false } }))
  } catch (err) {
    console.warn(`[${ID}] status failed`, err)
  }
}

export function createWatcher(ctx, hostApi = host) {
  const seen = new Map() // runtime session id -> stored session id, for chats the user opened here
  const checked = new Map() // reply key -> true, checked or being checked
  const notes = atom([]) // the pending notes, in arrival order; restored from the backend once per start
  const folded = atom(false)
  const asking = new Set()
  const gone = new Set()
  const capture = () => {
    const runtimeId = hostApi.state.focusedSessionId.get()
    if (runtimeId) remember(seen, runtimeId, hostApi.state.focusedStoredSessionId.get() || null, SEEN_MAX)
  }
  // The app sets the two focus atoms one after the other, in either order: read the pair once both
  // have settled, or a chat is filed under the other chat's stored id.
  let pending = false
  // The backend said Asterisk stays off here (a core too old, or the 2.x package still installed).
  let off = false
  let noModelShown = false
  const noteFocus = () => {
    if (pending) return
    pending = true
    queueMicrotask(() => {
      pending = false
      capture()
    })
  }

  async function onComplete(event) {
    if (off) return
    const sid = event?.session_id
    const payload = event?.payload
    if (!sid || !seen.has(sid) || !eligible(payload)) return
    const finalId = payload.persisted_turn?.final_assistant_row_id
    const key = typeof finalId === 'number' ? `${replyKey(payload.text)}:${finalId}` : replyKey(payload.text)
    if (checked.has(key)) return
    remember(checked, key, true, CHECKED_MAX)
    let note
    try {
      // The reply's OWN chat (not necessarily the focused one) and the turn's receipt. A missing one is
      // still sent: the backend decides whether to skip it.
      const body = { session_id: seen.get(sid) || null, turn: payload.persisted_turn || null }
      const result = await ctx.rest('/check', { method: 'POST', body })
      note = noteFor(result, { key, storedId: seen.get(sid) })
    } catch (err) {
      const detail = String(err?.message || err)
      console.warn(`[${ID}] check failed`, err)
      if (detail.includes('no model chosen')) {
        if (!noModelShown) {
          noModelShown = true
          hostApi.notify({ id: `${ID}-no-model`, kind: 'warning', title: t('asterisk.title'), message: t('asterisk.noModel') })
        }
        return
      }
      hostApi.notify({ id: `${ID}-error`, kind: 'error', title: t('asterisk.title'), message: t('asterisk.failed', detail) })
      return
    }
    if (!note) return
    notes.set([...notes.get(), note])
    folded.set(false)
    if (ctx.pet?.visible?.get?.()) ctx.pet.say(t('asterisk.pet'), { id: ID, tone: 'info' })
  }

  /** The note leaves the strip, nothing else. */
  const dismiss = id => notes.set(notes.get().filter(n => n.id !== id))

  /** A button removes the note and the backend records it against its check, with the signal (no text). */
  async function leave(note, signal, label) {
    gone.add(note.checkAt)
    dismiss(note.id)
    try {
      await ctx.rest('/dismiss', { method: 'POST', body: { check_at: note.checkAt, signal } })
    } catch (err) {
      const detail = String(err?.message || err)
      console.warn(`[${ID}] feedback failed`, err)
      hostApi.notify({ id: `${ID}-feedback-error`, kind: 'error', title: t('asterisk.title'), message: t('asterisk.feedbackFailed', label, detail) })
    }
  }
  const gotIt = note => leave(note, 'read', t('asterisk.gotIt'))
  const knew = note => leave(note, 'already_knew', t('asterisk.knew'))
  const notSure = note => leave(note, 'unsure', t('asterisk.notSure'))
  const notUseful = note => leave(note, 'not_useful', t('asterisk.notUseful'))

  async function ask(note) {
    if (asking.has(note.id)) return
    asking.add(note.id)
    let done = false
    try {
      const lead = note.tone === 'playful' && Object.hasOwn(en.asterisk.settings.kinds, note.kind) ? t(`asterisk.settings.kinds.${note.kind}.label`) : note.headline
      done = await hostApi.composer.insertText(note.storedId, t('asterisk.askText', lead, note.text), { mode: 'block' })
    } catch (err) {
      console.warn(`[${ID}] insert failed`, err)
    } finally {
      asking.delete(note.id)
    }
    if (done !== true) {
      hostApi.notify({ id: `${ID}-ask-failed`, kind: 'warning', title: t('asterisk.title'), message: t('asterisk.askFailed') })
      return
    }
    await leave(note, 'asked', t('asterisk.askInChat'))
  }

  const toggleFold = () => folded.set(!folded.get())

  /** Asks the backend once whether to run; a failed or malformed answer changes nothing and shows nothing. */
  async function status() {
    let answer
    try {
      answer = await ctx.rest('/status', { method: 'POST', body: { desktop_ready: true } })
    } catch (err) {
      console.warn(`[${ID}] status failed`, err)
      return
    }
    if (!isStatus(answer)) return
    off = !answer.ready || answer.old_install
    tellUpdate(hostApi, answer)
    if (answer.old_install) {
      hostApi.notify({ id: `${ID}-old-install`, kind: 'warning', title: t('asterisk.title'), message: t('asterisk.oldInstall') })
    }
  }

  async function restore() {
    if (off) return
    let entries
    try {
      const answer = await ctx.rest('/notes', { method: 'POST', body: {} })
      if (!Array.isArray(answer?.notes)) throw new Error(t('asterisk.noNotes'))
      entries = answer.notes
    } catch (err) {
      const detail = String(err?.message || err)
      console.warn(`[${ID}] restore failed`, err)
      hostApi.notify({ id: `${ID}-restore-error`, kind: 'error', title: t('asterisk.title'), message: t('asterisk.restoreFailed', detail) })
      return
    }
    const back = []
    for (const entry of [...entries].sort((a, b) => a?.at - b?.at)) {
      try {
        const note = noteFor(entry, { key: String(entry?.at), storedId: entry?.session_id })
        if (note && !gone.has(note.checkAt)) back.push(note)
      } catch (err) {
        console.warn(`[${ID}] a stored note was skipped`, err)
      }
    }
    const backAt = new Set(back.map(n => n.checkAt))
    notes.set([...back, ...notes.get().filter(n => !backAt.has(n.checkAt))])
  }

  return { capture, noteFocus, onComplete, dismiss, gotIt, knew, notSure, notUseful, ask, toggleFold, status, restore, notes, folded, seen, checked }
}

// Typography, hairlines, the stroke and one chevron: no box, no fill. Every colour is an app theme
// token, so the strip follows the theme and light/dark. Animation runs under data-motion="full" only.
const CSS = `
.asterisk-strip{min-width:0;max-height:360px;overflow-y:auto;padding:12px 14px 4px;font-family:var(--font-sans);border-bottom:1px solid var(--ui-stroke-quaternary)}
.asterisk-strip[data-folded="true"]{padding-bottom:12px}
.asterisk-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.asterisk-label{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;line-height:1.4}
.asterisk-label-name{color:var(--ui-accent);font-weight:600}
.asterisk-h-label{position:relative;display:inline-block}
.asterisk-label-count{color:var(--ui-text-tertiary)}
.asterisk-fold{display:inline-flex;align-items:center;justify-content:center;flex:none;padding:2px;border:0;border-radius:4px;background:transparent;cursor:pointer;color:var(--ui-text-tertiary)}
.asterisk-fold:hover{color:var(--ui-text-primary)}
.asterisk-fold:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.asterisk-fold[aria-expanded="false"] svg{transform:rotate(180deg)}
[data-motion="full"] .asterisk-fold svg{transition:transform .2s ease}
.asterisk-list{list-style:none;margin:0;padding:0}
.asterisk-entry{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;align-items:start;padding:10px 0 12px;border-bottom:1px solid var(--ui-stroke-quaternary)}
.asterisk-entry:last-child{border-bottom:0}
.asterisk-entry.asterisk-numbered{grid-template-columns:48px minmax(0,1fr) auto}
.asterisk-num{font-family:${SERIF};font-size:30px;line-height:1;font-variant-numeric:lining-nums;color:color-mix(in srgb, var(--ui-accent) 85%, var(--ui-text-primary))}
.asterisk-body{min-width:0}
.asterisk-headline{margin:0}
.asterisk-h{position:relative;display:inline-block;max-width:100%;font-family:${SERIF};font-size:20px;line-height:1.2;color:var(--ui-text-primary);overflow-wrap:anywhere}
.asterisk-stroke{position:absolute;left:0;bottom:-6px;width:100%;height:8px;overflow:visible}
.asterisk-stroke path{fill:none;stroke:var(--ui-accent);stroke-width:2.2;stroke-linecap:round;stroke-dasharray:400;stroke-dashoffset:0}
.asterisk-text{margin:12px 0 0;font-size:12px;line-height:1.55;color:var(--ui-text-secondary);overflow-wrap:anywhere}
.asterisk-meta{margin:5px 0 0;font-size:10.5px;color:var(--ui-text-tertiary);overflow-wrap:anywhere}
.asterisk-from{margin-top:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.asterisk-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.asterisk-go{align-self:center}
.asterisk-btn{font:inherit;font-size:11.5px;line-height:1.3;padding:3px 10px;border-radius:6px;background:transparent;cursor:pointer;color:var(--ui-text-primary);border:1px solid var(--ui-stroke-secondary)}
.asterisk-btn:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.asterisk-gotit{color:var(--ui-accent);border-color:color-mix(in srgb, var(--ui-accent) 45%, transparent)}
.asterisk-dot{display:inline-block;flex:none;width:6px;height:6px;border-radius:50%;background:var(--ui-accent)}
[data-motion="full"] .asterisk-stroke path{stroke-dashoffset:400;animation:asterisk-draw 1.1s .3s cubic-bezier(.6,.1,.2,1) forwards}
[data-motion="full"] .asterisk-entry{animation:asterisk-up .5s both}
[data-motion="reduce"] .asterisk-stroke path{stroke-dashoffset:0}
@keyframes asterisk-draw{to{stroke-dashoffset:0}}
@keyframes asterisk-up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
`

const reducedMotion = () => Boolean(globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)

function Stroke() {
  return jsx('svg', {
    className: 'asterisk-stroke',
    'data-asterisk': 'stroke',
    'aria-hidden': 'true',
    viewBox: '0 0 200 8',
    preserveAspectRatio: 'none',
    children: jsx('path', { d: 'M2 5 C 40 2, 80 7, 120 4 S 180 3, 198 5' })
  })
}

function Button({ className, onClick, children }) {
  return jsx('button', { type: 'button', className: className ? `asterisk-btn ${className}` : 'asterisk-btn', onClick, children })
}

function Entry({ note, index, numbered, focused, motion, t, watcher }) {
  const here = Boolean(note.storedId) && note.storedId === focused
  const expanded = !numbered || here
  const open = () => void host.openSession(note.storedId)
  const title = filled(note.title) ? note.title : t('asterisk.untitled')
  const by = note.by === 'user' ? t('asterisk.by.user') : t('asterisk.by.assistant')
  const body = expanded
    ? [
        jsx('p', { className: 'asterisk-text', 'data-asterisk': 'text', children: note.text }, 'text'),
        jsx('p', { className: 'asterisk-meta', 'data-asterisk': 'meta', children: t('asterisk.meta', note.cost, by, here ? '' : title, note.model) }, 'meta'),
        jsxs('div', {
          className: 'asterisk-actions',
          children: [
            jsx(Button, { onClick: () => void watcher.knew(note), children: t('asterisk.knew') }, 'knew'),
            jsx(Button, { onClick: () => void watcher.notSure(note), children: t('asterisk.notSure') }, 'unsure'),
            jsx(Button, { onClick: () => void watcher.notUseful(note), children: t('asterisk.notUseful') }, 'not_useful'),
            here
              ? jsx(Button, { onClick: () => void watcher.ask(note), children: t('asterisk.askInChat') }, 'ask')
              : jsx(Button, { onClick: open, children: t('asterisk.open') }, 'open'),
            jsx(Button, { className: 'asterisk-gotit', onClick: () => void watcher.gotIt(note), children: t('asterisk.gotIt') }, 'gotit')
          ]
        }, 'actions')
      ]
    : [jsx('p', { className: 'asterisk-meta asterisk-from', 'data-asterisk': 'meta', children: t('asterisk.from', title, note.cost, note.model) }, 'line')]
  return jsxs('li', {
    className: numbered ? 'asterisk-entry asterisk-numbered' : 'asterisk-entry',
    'data-asterisk': 'entry',
    'data-expanded': expanded ? 'true' : 'false',
    style: motion === 'full' ? { animationDelay: `${index * STAGGER_MS}ms` } : undefined,
    children: [
      numbered ? jsx('span', { className: 'asterisk-num', 'data-asterisk': 'num', children: String(index + 1) }, 'num') : null,
      jsxs('div', {
        className: 'asterisk-body',
        children: [
          jsx('p', {
            className: 'asterisk-headline',
            children: jsxs('span', { className: 'asterisk-h', 'data-asterisk': 'headline', children: [note.headline, jsx(Stroke, {})] })
          }, 'headline'),
          ...body
        ]
      }, 'body'),
      expanded ? null : jsx('div', { className: 'asterisk-go', children: jsx(Button, { onClick: open, children: t('asterisk.open') }) }, 'go')
    ]
  })
}

function Chevron() {
  return jsx('svg', {
    'aria-hidden': 'true',
    viewBox: '0 0 12 12',
    width: 12,
    height: 12,
    children: jsx('path', { d: 'M3 7.5 L6 4.5 L9 7.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' })
  })
}

/** The `composer.top` contribution: the "Worth knowing" strip, or nothing when no note is pending. */
export function createStrip(watcher) {
  return function AsteriskStrip() {
    const list = useValue(watcher.notes)
    const isFolded = useValue(watcher.folded)
    const focused = useValue(host.state.focusedStoredSessionId)
    const t = usePluginI18n(ID)
    if (!list.length) return null
    const motion = reducedMotion() ? 'reduce' : 'full'
    const numbered = list.length > 1
    const label = t('asterisk.label')
    const foldLabel = isFolded ? t('asterisk.expand') : t('asterisk.collapse')
    return jsxs(Fragment, {
      children: [
        jsx('style', { children: CSS }),
        jsxs('section', {
          className: 'asterisk-strip',
          'data-asterisk': 'strip',
          role: 'region',
          'aria-label': label,
          'aria-live': 'polite',
          'data-motion': motion,
          'data-folded': isFolded ? 'true' : 'false',
          'data-count': String(list.length),
          children: [
            jsxs('div', {
              className: 'asterisk-head',
              children: [
                jsxs('div', {
                  className: 'asterisk-label',
                  'data-asterisk': 'label',
                  children: [
                    isFolded
                      ? jsxs('span', { className: 'asterisk-label-name asterisk-h-label', children: [label, jsx(Stroke, {})] })
                      : jsx('span', { className: 'asterisk-label-name', children: label }),
                    isFolded || numbered ? jsx('span', { className: 'asterisk-label-count', children: ` · ${t('asterisk.count', list.length)}` }) : null
                  ]
                }),
                jsx('button', {
                  type: 'button',
                  className: 'asterisk-fold',
                  'data-asterisk': 'fold',
                  'aria-expanded': isFolded ? 'false' : 'true',
                  'aria-label': foldLabel,
                  title: foldLabel,
                  onClick: watcher.toggleFold,
                  children: jsx(Chevron, {})
                })
              ]
            }),
            isFolded
              ? null
              : jsx('ol', {
                  className: 'asterisk-list',
                  children: list.map((note, index) => jsx(Entry, { note, index, numbered, focused, motion, t, watcher }, note.id))
                })
          ]
        })
      ]
    })
  }
}

/** The `sessionRow.trailing` contribution: a dot on the row of a chat with a pending note. */
export function createDot(watcher) {
  return function AsteriskDot({ sessionId }) {
    const list = useValue(watcher.notes)
    const t = usePluginI18n(ID)
    if (!sessionId || !list.some(n => n.storedId === sessionId)) return null
    const label = t('asterisk.dotLabel')
    return jsx('span', { className: 'asterisk-dot', 'data-asterisk': 'dot', role: 'img', 'aria-label': label, title: label })
  }
}

const SETTINGS_CSS = `
.asterisk-settings{container-type:inline-size;container-name:asterisk-settings;display:flex;flex-direction:column;gap:28px;min-width:0;max-width:900px;font-family:var(--font-sans);color:var(--ui-text-primary)}
.asterisk-settings section{min-width:0}
.asterisk-settings h2{margin:0;font-size:15px;font-weight:600;line-height:1.3;color:var(--ui-text-primary)}
.asterisk-set-note{margin:10px 0 0;font-size:12px;line-height:1.5;color:var(--ui-text-tertiary);min-width:0;overflow-wrap:anywhere}
.asterisk-set-status{margin:0;font-size:12.5px;line-height:1.5;color:var(--ui-text-secondary);min-width:0;overflow-wrap:anywhere}
.asterisk-group{margin:16px 0 2px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ui-text-tertiary)}
.asterisk-kinds{list-style:none;margin:0;padding:0}
.asterisk-kind{display:flex;align-items:flex-start;gap:14px;padding:10px 0;border-bottom:1px solid var(--ui-stroke-quaternary)}
.asterisk-kind-text{flex:1 1 0;min-width:0;overflow-wrap:anywhere}
.asterisk-kind-label{margin:0;font-size:13px;font-weight:500;line-height:1.4}
.asterisk-kind-desc{margin:2px 0 0;font-size:12px;line-height:1.5;color:var(--ui-text-secondary)}
.asterisk-kind-locked{margin:4px 0 0;font-size:11px;line-height:1.4;color:var(--ui-text-tertiary)}
.asterisk-settings .asterisk-switch{position:relative;flex:none;width:32px;height:18px;margin-top:2px;padding:0;border:1px solid var(--ui-stroke-secondary);border-radius:9px;background:transparent;cursor:pointer}
.asterisk-settings .asterisk-switch[aria-checked="true"]{background:var(--ui-accent);border-color:var(--ui-accent)}
.asterisk-settings .asterisk-switch:disabled{cursor:default;opacity:.55}
.asterisk-settings .asterisk-switch:focus-visible,.asterisk-settings .asterisk-tone:focus-visible,.asterisk-settings .asterisk-suggest-btn:focus-visible,.asterisk-settings .asterisk-retry:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.asterisk-knob{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--ui-text-tertiary)}
.asterisk-switch[aria-checked="true"] .asterisk-knob{left:16px;background:var(--ui-bg-chrome)}
[data-motion="full"] .asterisk-knob{transition:left .15s ease}
.asterisk-tones{display:flex;flex-direction:column;gap:6px;margin-top:12px}
.asterisk-settings .asterisk-tone{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;min-width:0;padding:8px 12px;font:inherit;text-align:left;border:1px solid var(--ui-stroke-secondary);border-radius:8px;background:transparent;color:var(--ui-text-primary);cursor:pointer;overflow-wrap:anywhere}
.asterisk-settings .asterisk-tone[aria-checked="true"]{border-color:var(--ui-accent);box-shadow:inset 0 0 0 1px var(--ui-accent)}
.asterisk-settings .asterisk-tone:disabled,.asterisk-settings .asterisk-suggest-btn:disabled{cursor:default;opacity:.55}
.asterisk-tone-label{font-size:13px;font-weight:500}
.asterisk-tone-desc{font-size:12px;line-height:1.45;color:var(--ui-text-tertiary)}
.asterisk-summary{margin:10px 0 0;font-size:12.5px;line-height:1.5;color:var(--ui-text-secondary);min-width:0;overflow-wrap:anywhere}
.asterisk-suggestion{display:flex;align-items:center;gap:12px;margin-top:12px;padding:10px 12px;min-width:0;border:1px solid var(--ui-stroke-secondary);border-left:2px solid var(--ui-accent);border-radius:8px}
.asterisk-suggest-text{flex:1 1 0;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--ui-text-primary);overflow-wrap:anywhere}
.asterisk-suggest-acts{display:flex;flex-wrap:wrap;gap:6px;flex:none}
.asterisk-settings .asterisk-suggest-btn,.asterisk-settings .asterisk-retry{font:inherit;font-size:11.5px;line-height:1.3;padding:3px 10px;border-radius:6px;background:transparent;cursor:pointer;color:var(--ui-text-primary);border:1px solid var(--ui-stroke-secondary)}
.asterisk-settings .asterisk-retry{margin-top:10px}
.asterisk-table-wrap{margin-top:18px;min-width:0;overflow-x:auto}
.asterisk-table{width:100%;border-collapse:collapse;font-size:11px;line-height:1.35;font-variant-numeric:tabular-nums}
.asterisk-table caption{padding-bottom:6px;text-align:left;font-size:12px;font-weight:600;color:var(--ui-text-primary)}
.asterisk-table th,.asterisk-table td{min-width:0;padding:4px 5px;text-align:right;vertical-align:bottom;border-bottom:1px solid var(--ui-stroke-quaternary);overflow-wrap:anywhere}
.asterisk-table th{font-weight:500;color:var(--ui-text-tertiary);overflow-wrap:normal;hyphens:auto}
.asterisk-table td{color:var(--ui-text-secondary);white-space:nowrap}
.asterisk-table th:first-child,.asterisk-table td:first-child{text-align:left;color:var(--ui-text-primary);white-space:normal;overflow-wrap:anywhere;min-width:96px}
.asterisk-legend{margin:14px 0 0;padding:0;list-style:none;font-size:11px;line-height:1.5;color:var(--ui-text-tertiary);min-width:0;overflow-wrap:anywhere}
@container asterisk-settings (max-width: 520px){
.asterisk-table thead{display:none}
.asterisk-table,.asterisk-table tbody,.asterisk-table tr,.asterisk-table td{display:block;width:auto}
.asterisk-table caption{display:block}
.asterisk-table tr{padding:8px 0;border-bottom:1px solid var(--ui-stroke-quaternary)}
.asterisk-table td{display:flex;justify-content:space-between;gap:12px;padding:2px 0;border:0}
.asterisk-table td::before{content:attr(data-label);min-width:0;text-align:left;color:var(--ui-text-tertiary)}
.asterisk-table td:first-child{font-weight:600}
.asterisk-table td:first-child::before{content:none}
.asterisk-suggestion{flex-direction:column;align-items:stretch}
}
`

const OUTCOME_COLS = ['shown', 'filtered', 'asked', 'read', 'already_knew', 'unsure', 'not_useful', 'open', 'evicted', 'chat_gone', 'unrecorded']
const MONEY_COLS = ['checks', 'spend_usd', 'cost_per_asked_usd']

export function fmtUsd(usd) {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return ''
  if (usd > 0 && usd < 0.005) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

const isReport = r => Boolean(r) && typeof r === 'object' && Array.isArray(r.kinds) && Array.isArray(r.settings?.enabled)
  && typeof r.settings.tone === 'string' && Boolean(r.totals) && Array.isArray(r.by_kind)

export function createSettings(ctx, hostApi = host) {
  const state = atom({ status: 'loading', report: null, busy: false, detail: '' })
  async function load() {
    state.set({ ...state.get(), status: 'loading', busy: false })
    try {
      const report = await ctx.rest('/report', { method: 'POST', body: {} })
      if (!isReport(report)) throw new Error(t('asterisk.settings.noReport'))
      state.set({ status: 'ready', report, busy: false, detail: '' })
    } catch (err) {
      console.warn(`[${ID}] report failed`, err)
      state.set({ status: 'error', report: null, busy: false, detail: String(err?.message || err) })
    }
  }
  async function send(path, body) {
    if (state.get().busy || state.get().status !== 'ready') return
    state.set({ ...state.get(), busy: true })
    try {
      const report = await ctx.rest(path, { method: 'POST', body })
      if (!isReport(report)) throw new Error(t('asterisk.settings.noReport'))
      state.set({ status: 'ready', report, busy: false, detail: '' })
    } catch (err) {
      const detail = String(err?.message || err)
      console.warn(`[${ID}] settings failed`, err)
      state.set({ ...state.get(), busy: false })
      hostApi.notify({ id: `${ID}-settings-error`, kind: 'error', title: t('asterisk.title'), message: t('asterisk.settings.saveFailed', detail) })
    }
  }
  const current = () => state.get().report?.settings
  const toggle = kind => {
    const report = state.get().report
    if (!report || report.kinds.find(k => k.kind === kind)?.locked) return undefined
    const on = report.settings.enabled
    return send('/settings', { tone: report.settings.tone, enabled: on.includes(kind) ? on.filter(k => k !== kind) : [...on, kind] })
  }
  const setTone = tone => (current() ? send('/settings', { tone, enabled: current().enabled }) : undefined)
  const turnOff = kind => (current() ? send('/settings', { tone: current().tone, enabled: current().enabled.filter(k => k !== kind) }) : undefined)
  const keep = kind => send('/keep', { kind })
  return { state, load, toggle, setTone, turnOff, keep }
}

const kindLabel = (t, kind) => (kind in en.asterisk.settings.kinds ? t(`asterisk.settings.kinds.${kind}.label`) : t('asterisk.settings.other'))

function KindsSection({ report, busy, t, settings }) {
  const groups = [...new Set(report.kinds.map(k => k.group))]
  return jsxs('section', {
    'data-asterisk': 'kinds',
    children: [
      jsx('h2', { children: t('asterisk.settings.kindsTitle') }),
      ...groups.map(group => jsxs(Fragment, {
        children: [
          jsx('p', { className: 'asterisk-group', 'data-asterisk': 'group', children: t('asterisk.settings.group', group) }),
          jsx('ul', {
            className: 'asterisk-kinds',
            children: report.kinds.filter(k => k.group === group).map(k => {
              const on = k.locked || report.settings.enabled.includes(k.kind)
              const label = kindLabel(t, k.kind)
              return jsxs('li', {
                className: 'asterisk-kind',
                'data-asterisk': 'kind-row',
                'data-kind': k.kind,
                children: [
                  jsxs('div', {
                    className: 'asterisk-kind-text',
                    children: [
                      jsx('p', { className: 'asterisk-kind-label', children: label }),
                      jsx('p', { className: 'asterisk-kind-desc', children: t(`asterisk.settings.kinds.${k.kind}.description`) }),
                      k.locked ? jsx('p', { className: 'asterisk-kind-locked', 'data-asterisk': 'locked', children: t('asterisk.settings.locked') }) : null
                    ]
                  }),
                  jsx('button', {
                    type: 'button',
                    role: 'switch',
                    className: 'asterisk-switch',
                    'aria-checked': on ? 'true' : 'false',
                    'aria-label': label,
                    disabled: k.locked || busy,
                    onClick: () => void settings.toggle(k.kind),
                    children: jsx('span', { className: 'asterisk-knob', 'aria-hidden': 'true' })
                  })
                ]
              }, k.kind)
            })
          })
        ]
      }, `group-${group}`)),
      jsx('p', { className: 'asterisk-set-note', children: t('asterisk.settings.order') })
    ]
  })
}

function ToneSection({ report, busy, t, settings }) {
  const title = t('asterisk.settings.toneTitle')
  return jsxs('section', {
    'data-asterisk': 'tone',
    children: [
      jsx('h2', { children: title }),
      jsx('div', {
        className: 'asterisk-tones',
        role: 'radiogroup',
        'aria-label': title,
        children: report.tones.map(tone => jsxs('button', {
          type: 'button',
          role: 'radio',
          className: 'asterisk-tone',
          'data-tone': tone,
          'aria-checked': report.settings.tone === tone ? 'true' : 'false',
          disabled: busy,
          onClick: () => void settings.setTone(tone),
          children: [
            jsx('span', { className: 'asterisk-tone-label', children: t(`asterisk.settings.tones.${tone}.label`) }),
            jsx('span', { className: 'asterisk-tone-desc', children: t(`asterisk.settings.tones.${tone}.description`) })
          ]
        }, tone))
      }),
      jsx('p', { className: 'asterisk-set-note', children: t('asterisk.settings.toneNote') })
    ]
  })
}

function Table({ name, caption, keyLabel, rows, cols, label, t }) {
  const cell = (row, col) => {
    const v = row[col]
    if (col === 'spend_usd' || col === 'cost_per_asked_usd') return fmtUsd(v) || t('asterisk.settings.none')
    return typeof v === 'number' ? String(v) : t('asterisk.settings.none')
  }
  return jsx('div', {
    className: 'asterisk-table-wrap',
    children: jsxs('table', {
      className: 'asterisk-table',
      'data-asterisk': name,
      children: [
        jsx('caption', { children: caption }),
        jsx('thead', {
          children: jsxs('tr', {
            children: [jsx('th', { scope: 'col', children: keyLabel }, 'key'), ...cols.map(col => jsx('th', { scope: 'col', children: t(`asterisk.settings.cols.${col}`) }, col))]
          })
        }),
        jsx('tbody', {
          children: rows.map(row => jsxs('tr', {
            children: [
              jsx('td', { 'data-label': keyLabel, children: label(row.key) }, 'key'),
              ...cols.map(col => jsx('td', { 'data-label': t(`asterisk.settings.cols.${col}`), children: cell(row, col) }, col))
            ]
          }, row.key))
        })
      ]
    })
  })
}

function ReportSection({ report, busy, t, settings }) {
  const totals = report.totals
  const head = jsx('h2', { children: t('asterisk.settings.reportTitle') })
  if (!totals.checks) {
    return jsxs('section', { 'data-asterisk': 'report', children: [head, jsx('p', { className: 'asterisk-summary', 'data-asterisk': 'empty', children: t('asterisk.settings.empty') })] })
  }
  const skipped = Object.values(totals.skips || {}).reduce((a, b) => a + b, 0)
  const since = typeof report.since === 'number' ? new Date(report.since * 1000).toISOString().slice(0, 10) : ''
  const summary = [
    t('asterisk.settings.checks', totals.checks),
    t('asterisk.settings.notes', totals.notes),
    t('asterisk.settings.spent', fmtUsd(totals.spend_usd) || t('asterisk.settings.none')),
    totals.cost_per_asked_usd === null ? '' : t('asterisk.settings.perAsked', fmtUsd(totals.cost_per_asked_usd)),
    t('asterisk.settings.skipped', skipped),
    since ? t('asterisk.settings.since', since) : ''
  ].filter(Boolean).join(' · ')
  const toneLabel = key => t(`asterisk.settings.tones.${key}.label`)
  const modelLabel = key => (key === 'unknown' ? t('asterisk.settings.unknownModel') : key)
  return jsxs('section', {
    'data-asterisk': 'report',
    children: [
      head,
      jsx('p', { className: 'asterisk-summary', 'data-asterisk': 'summary', children: summary }),
      ...(report.suggestions || []).map(s => jsxs('div', {
        className: 'asterisk-suggestion',
        'data-asterisk': 'suggestion',
        'data-kind': s.kind,
        children: [
          jsx('p', { className: 'asterisk-suggest-text', children: t('asterisk.settings.suggest', kindLabel(t, s.kind), s.negative, s.rated) }),
          jsxs('div', {
            className: 'asterisk-suggest-acts',
            children: [
              jsx('button', { type: 'button', className: 'asterisk-suggest-btn', 'data-asterisk': 'turn-off', disabled: busy, onClick: () => void settings.turnOff(s.kind), children: t('asterisk.settings.turnOff') }),
              jsx('button', { type: 'button', className: 'asterisk-suggest-btn', 'data-asterisk': 'keep', disabled: busy, onClick: () => void settings.keep(s.kind), children: t('asterisk.settings.keep') })
            ]
          })
        ]
      }, `suggest-${s.kind}`)),
      jsx(Table, { name: 'by-kind', caption: t('asterisk.settings.byKind'), keyLabel: t('asterisk.settings.kindCol'), rows: report.by_kind, cols: OUTCOME_COLS, label: key => kindLabel(t, key), t }, 'by-kind'),
      jsx(Table, { name: 'by-model', caption: t('asterisk.settings.byModel'), keyLabel: t('asterisk.settings.modelCol'), rows: report.by_model || [], cols: [...MONEY_COLS, ...OUTCOME_COLS], label: modelLabel, t }, 'by-model'),
      jsx(Table, { name: 'by-tone', caption: t('asterisk.settings.byTone'), keyLabel: t('asterisk.settings.toneCol'), rows: report.by_tone || [], cols: [...MONEY_COLS, ...OUTCOME_COLS], label: toneLabel, t }, 'by-tone'),
      jsxs('ul', {
        className: 'asterisk-legend',
        'data-asterisk': 'legend',
        children: [
          jsx('li', { children: t('asterisk.settings.legendFiltered') }, 'filtered'),
          jsx('li', { children: t('asterisk.settings.legendDropped', report.notes_max) }, 'dropped'),
          jsx('li', { children: t('asterisk.settings.legendUnrecorded') }, 'unrecorded')
        ]
      }, 'legend')
    ]
  })
}

export function createSettingsPage(settings) {
  return function AsteriskSettings() {
    const view = useValue(settings.state)
    const t = usePluginI18n(ID)
    useEffect(() => {
      void settings.load()
    }, [])
    const motion = reducedMotion() ? 'reduce' : 'full'
    let body
    if (view.status === 'ready' && view.report) {
      const props = { report: view.report, busy: view.busy, t, settings }
      body = [jsx(KindsSection, { ...props }, 'kinds'), jsx(ToneSection, { ...props }, 'tone'), jsx(ReportSection, { ...props }, 'report')]
    } else if (view.status === 'error') {
      body = [jsxs('div', {
        'data-asterisk': 'load-error',
        children: [
          jsx('p', { className: 'asterisk-set-status', children: t('asterisk.settings.loadFailed', view.detail) }),
          jsx('button', { type: 'button', className: 'asterisk-retry', 'data-asterisk': 'retry', onClick: () => void settings.load(), children: t('asterisk.settings.retry') })
        ]
      }, 'error')]
    } else {
      body = [jsx('p', { className: 'asterisk-set-status', 'data-asterisk': 'loading', children: t('asterisk.settings.loading') }, 'loading')]
    }
    return jsxs('div', {
      className: 'asterisk-settings',
      'data-asterisk': 'settings',
      'data-motion': motion,
      children: [jsx('style', { children: SETTINGS_CSS }, 'style'), ...body]
    })
  }
}

export default {
  id: ID,
  name: 'Asterisk',
  register(ctx) {
    if (!desktopReady()) {
      void standDown(ctx)
      return
    }
    ctx.i18n.register({ en })
    const watcher = createWatcher(ctx)
    watcher.capture()
    const unlisten = [host.state.focusedSessionId.listen(watcher.noteFocus), host.state.focusedStoredSessionId.listen(watcher.noteFocus)]
    ctx.onDispose(() => unlisten.forEach(fn => fn?.()))
    ctx.onEvent('message.complete', event => void watcher.onComplete(event))
    ctx.register({ id: 'headline', area: COMPOSER_AREAS.top, render: createStrip(watcher) })
    ctx.register({ id: 'dot', area: SESSION_ROW_AREAS.trailing, data: { render: createDot(watcher) } })
    ctx.registerSettingsPage?.({ id: 'settings', title: ctx.i18n.t('asterisk.title'), icon: 'eye', render: createSettingsPage(createSettings(ctx)) })
    void watcher.status().then(() => watcher.restore())
  }
}
