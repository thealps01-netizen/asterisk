/**
 * You Should Know — names the one thing a long reply did not plainly tell the user, if there is one.
 *
 * When a reply of a chat the user has opened in this app finishes (`message.complete`, status
 * complete, a new reply, at least MIN_CHARS long), the plugin sends the backend that chat's stored id
 * and the frame's `persisted_turn` receipt (the turn's committed row ids). The backend reads that
 * whole turn — the user's message, the assistant's tool calls and their results, the final reply —
 * and a second model (Opus) returns one point or none: an unstated tradeoff, a result that may be
 * off, a silent assumption, an understated irreversible step, a security risk or a cost, saying who
 * decided it (the assistant or the user), as a short headline and one sentence. Nothing to flag ->
 * nothing shown (the normal case).
 *
 * A point becomes a note in the "Worth knowing" strip at the top of the composer (`composer.top`):
 * the headline in a serif, underlined by a stroke in the theme's accent; with several notes, a
 * numbered list in arrival order. A note of the focused chat (or the only note) shows its sentence,
 * the check's cost and who decided, and "Already knew" / "Got it"; a note of another chat is one
 * line with that chat's title and "Open". A note stays until "Already knew" or "Got it" removes it;
 * only "Already knew" is recorded (POST /feedback, no text). The sidebar row of a chat with a
 * pending note carries a dot in the accent (`sessionRow.trailing`). Notes live in memory only and
 * are gone after a restart. With a Hermes pet on screen it also says so in its bubble. Reduced
 * motion: no stroke drawing and no stagger.
 *
 * Each reply is checked once. A failed check is one error notice, named, never swallowed. The
 * plugin writes nothing of its own: the backend keeps a cost ledger with no text in it (see
 * Docs/you-should-know-notes.md). Colours and type come from the app's theme tokens only.
 */
import { atom, COMPOSER_AREAS, host, SESSION_ROW_AREAS, usePluginI18n, useValue } from '@hermes/plugin-sdk'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'

const ID = 'you-should-know'
export const MIN_CHARS = 3000
const SEEN_MAX = 500
const CHECKED_MAX = 300
const STAGGER_MS = 80
const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif'

const en = {
  ysk: {
    title: 'You should know',
    label: 'Worth knowing',
    count: n => (n === 1 ? '1 note' : `${n} notes`),
    meta: (cost, by, title) => [title, 'Opus', cost, by].filter(Boolean).join(' · '),
    from: (title, cost) => (cost ? `${title} · Opus ${cost}` : `${title} · Opus`),
    untitled: 'Untitled chat',
    by: {
      assistant: 'decided by assistant',
      user: 'decided by you'
    },
    open: 'Open',
    knew: 'Already knew',
    gotIt: 'Got it',
    dotLabel: 'Worth knowing: a note waiting',
    failed: detail => `Could not check a long reply: ${detail}`,
    noHeadline: 'the answer has no headline',
    feedbackFailed: detail => `Could not record "Already knew": ${detail}`,
    pet: 'Worth knowing: a note above the input'
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

/** Whether a message.complete frame is a reply worth a check: complete, new, long enough. */
export function eligible(payload) {
  const p = payload || {}
  return p.status === 'complete' && !p.response_reused && typeof p.text === 'string' && p.text.length >= MIN_CHARS
}

const filled = v => typeof v === 'string' && v.trim() !== ''

/** The note for a check's answer; null when there is nothing to flag. A point it cannot show throws. */
export function noteFor(result, { key, storedId }) {
  const point = Array.isArray(result?.points) ? result.points[0] : undefined
  if (!point) return null
  if (!filled(point.headline) || !filled(point.text)) throw new Error(t('ysk.noHeadline'))
  return {
    id: `${ID}-${key}`,
    storedId,
    title: filled(result.title) ? result.title : null,
    headline: point.headline,
    text: point.text,
    by: point.by,
    cost: fmtCost(result.cost_usd, result.cost_status),
    checkAt: result.at
  }
}

/** Remember a value under a key, dropping the oldest entries past `max`. */
function remember(map, k, v, max) {
  map.delete(k)
  map.set(k, v)
  while (map.size > max) map.delete(map.keys().next().value)
}

export function createWatcher(ctx, hostApi = host) {
  const seen = new Map() // runtime session id -> stored session id, for chats the user opened here
  const checked = new Map() // reply key -> true, checked or being checked
  const notes = atom([]) // the pending notes, in arrival order; memory only
  const capture = () => {
    const runtimeId = hostApi.state.focusedSessionId.get()
    if (runtimeId) remember(seen, runtimeId, hostApi.state.focusedStoredSessionId.get() || null, SEEN_MAX)
  }
  // The app sets the two focus atoms one after the other, in either order: read the pair once both
  // have settled, or a chat is filed under the other chat's stored id.
  let pending = false
  const noteFocus = () => {
    if (pending) return
    pending = true
    queueMicrotask(() => {
      pending = false
      capture()
    })
  }

  async function onComplete(event) {
    const sid = event?.session_id
    const payload = event?.payload
    if (!sid || !seen.has(sid) || !eligible(payload)) return
    const key = replyKey(payload.text)
    if (checked.has(key)) return
    remember(checked, key, true, CHECKED_MAX)
    let note
    try {
      // The reply's OWN chat (not necessarily the focused one) and the turn's receipt. A missing one is
      // still sent: the backend's refusal becomes the error notice, never a silent skip.
      const body = { session_id: seen.get(sid) || null, turn: payload.persisted_turn || null }
      const result = await ctx.rest('/check', { method: 'POST', body })
      note = noteFor(result, { key, storedId: seen.get(sid) })
    } catch (err) {
      const detail = String(err?.message || err)
      console.warn(`[${ID}] check failed`, err)
      hostApi.notify({ id: `${ID}-error`, kind: 'error', title: t('ysk.title'), message: t('ysk.failed', detail) })
      return
    }
    if (!note) return
    notes.set([...notes.get(), note])
    if (ctx.pet?.visible?.get?.()) ctx.pet.say(t('ysk.pet'), { id: ID, tone: 'info' })
  }

  /** "Got it": the note goes, nothing is recorded. */
  const dismiss = id => notes.set(notes.get().filter(n => n.id !== id))

  /** "Already knew": the note goes and the backend records it against its check (no text). */
  async function knew(note) {
    dismiss(note.id)
    try {
      await ctx.rest('/feedback', { method: 'POST', body: { check_at: note.checkAt } })
    } catch (err) {
      const detail = String(err?.message || err)
      console.warn(`[${ID}] feedback failed`, err)
      hostApi.notify({ id: `${ID}-feedback-error`, kind: 'error', title: t('ysk.title'), message: t('ysk.feedbackFailed', detail) })
    }
  }

  return { capture, noteFocus, onComplete, dismiss, knew, notes, seen, checked }
}

// Typography, hairlines and the stroke only: no box, no fill, no icon. Every colour is an app theme
// token, so the strip follows the theme and light/dark. Animation runs under data-motion="full" only.
const CSS = `
.ysk-strip{min-width:0;max-height:360px;overflow-y:auto;padding:12px 14px 4px;font-family:var(--font-sans);border-bottom:1px solid var(--ui-stroke-quaternary)}
.ysk-label{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;line-height:1.4}
.ysk-label-name{color:var(--ui-accent);font-weight:600}
.ysk-label-count{color:var(--ui-text-tertiary)}
.ysk-list{list-style:none;margin:0;padding:0}
.ysk-entry{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;align-items:start;padding:10px 0 12px;border-bottom:1px solid var(--ui-stroke-quaternary)}
.ysk-entry:last-child{border-bottom:0}
.ysk-entry.ysk-numbered{grid-template-columns:48px minmax(0,1fr) auto}
.ysk-num{font-family:${SERIF};font-size:30px;line-height:1;font-variant-numeric:lining-nums;color:color-mix(in srgb, var(--ui-accent) 85%, var(--ui-text-primary))}
.ysk-body{min-width:0}
.ysk-headline{margin:0}
.ysk-h{position:relative;display:inline-block;max-width:100%;font-family:${SERIF};font-size:20px;line-height:1.2;color:var(--ui-text-primary);overflow-wrap:anywhere}
.ysk-stroke{position:absolute;left:0;bottom:-6px;width:100%;height:8px;overflow:visible}
.ysk-stroke path{fill:none;stroke:var(--ui-accent);stroke-width:2.2;stroke-linecap:round;stroke-dasharray:400;stroke-dashoffset:0}
.ysk-text{margin:12px 0 0;font-size:12px;line-height:1.55;color:var(--ui-text-secondary);overflow-wrap:anywhere}
.ysk-meta{margin:5px 0 0;font-size:10.5px;color:var(--ui-text-tertiary);overflow-wrap:anywhere}
.ysk-from{margin-top:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ysk-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.ysk-go{align-self:center}
.ysk-btn{font:inherit;font-size:11.5px;line-height:1.3;padding:3px 10px;border-radius:6px;background:transparent;cursor:pointer;color:var(--ui-text-primary);border:1px solid var(--ui-stroke-secondary)}
.ysk-btn:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.ysk-gotit{color:var(--ui-accent);border-color:color-mix(in srgb, var(--ui-accent) 45%, transparent)}
.ysk-dot{display:inline-block;flex:none;width:6px;height:6px;border-radius:50%;background:var(--ui-accent)}
[data-motion="full"] .ysk-stroke path{stroke-dashoffset:400;animation:ysk-draw 1.1s .3s cubic-bezier(.6,.1,.2,1) forwards}
[data-motion="full"] .ysk-entry{animation:ysk-up .5s both}
[data-motion="reduce"] .ysk-stroke path{stroke-dashoffset:0}
@keyframes ysk-draw{to{stroke-dashoffset:0}}
@keyframes ysk-up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
`

const reducedMotion = () => Boolean(globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)

function Stroke() {
  return jsx('svg', {
    className: 'ysk-stroke',
    'data-ysk': 'stroke',
    'aria-hidden': 'true',
    viewBox: '0 0 200 8',
    preserveAspectRatio: 'none',
    children: jsx('path', { d: 'M2 5 C 40 2, 80 7, 120 4 S 180 3, 198 5' })
  })
}

function Button({ className, onClick, children }) {
  return jsx('button', { type: 'button', className: className ? `ysk-btn ${className}` : 'ysk-btn', onClick, children })
}

function Entry({ note, index, numbered, focused, motion, t, watcher }) {
  const here = Boolean(note.storedId) && note.storedId === focused
  const expanded = !numbered || here
  const open = () => void host.openSession(note.storedId)
  const title = filled(note.title) ? note.title : t('ysk.untitled')
  const by = note.by === 'user' ? t('ysk.by.user') : t('ysk.by.assistant')
  const body = expanded
    ? [
        jsx('p', { className: 'ysk-text', 'data-ysk': 'text', children: note.text }, 'text'),
        jsx('p', { className: 'ysk-meta', 'data-ysk': 'meta', children: t('ysk.meta', note.cost, by, here ? '' : title) }, 'meta'),
        jsxs('div', {
          className: 'ysk-actions',
          children: [
            jsx(Button, { onClick: () => void watcher.knew(note), children: t('ysk.knew') }, 'knew'),
            here ? null : jsx(Button, { onClick: open, children: t('ysk.open') }, 'open'),
            jsx(Button, { className: 'ysk-gotit', onClick: () => watcher.dismiss(note.id), children: t('ysk.gotIt') }, 'gotit')
          ]
        }, 'actions')
      ]
    : [jsx('p', { className: 'ysk-meta ysk-from', 'data-ysk': 'meta', children: t('ysk.from', title, note.cost) }, 'line')]
  return jsxs('li', {
    className: numbered ? 'ysk-entry ysk-numbered' : 'ysk-entry',
    'data-ysk': 'entry',
    'data-expanded': expanded ? 'true' : 'false',
    style: motion === 'full' ? { animationDelay: `${index * STAGGER_MS}ms` } : undefined,
    children: [
      numbered ? jsx('span', { className: 'ysk-num', 'data-ysk': 'num', children: String(index + 1) }, 'num') : null,
      jsxs('div', {
        className: 'ysk-body',
        children: [
          jsx('p', {
            className: 'ysk-headline',
            children: jsxs('span', { className: 'ysk-h', 'data-ysk': 'headline', children: [note.headline, jsx(Stroke, {})] })
          }, 'headline'),
          ...body
        ]
      }, 'body'),
      expanded ? null : jsx('div', { className: 'ysk-go', children: jsx(Button, { onClick: open, children: t('ysk.open') }) }, 'go')
    ]
  })
}

/** The `composer.top` contribution: the "Worth knowing" strip, or nothing when no note is pending. */
export function createStrip(watcher) {
  return function YouShouldKnowStrip() {
    const list = useValue(watcher.notes)
    const focused = useValue(host.state.focusedStoredSessionId)
    const t = usePluginI18n(ID)
    if (!list.length) return null
    const motion = reducedMotion() ? 'reduce' : 'full'
    const numbered = list.length > 1
    const label = t('ysk.label')
    return jsxs(Fragment, {
      children: [
        jsx('style', { children: CSS }),
        jsxs('section', {
          className: 'ysk-strip',
          'data-ysk': 'strip',
          role: 'region',
          'aria-label': label,
          'aria-live': 'polite',
          'data-motion': motion,
          'data-count': String(list.length),
          children: [
            jsxs('div', {
              className: 'ysk-label',
              'data-ysk': 'label',
              children: [
                jsx('span', { className: 'ysk-label-name', children: label }),
                numbered ? jsx('span', { className: 'ysk-label-count', children: ` · ${t('ysk.count', list.length)}` }) : null
              ]
            }),
            jsx('ol', {
              className: 'ysk-list',
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
  return function YouShouldKnowDot({ sessionId }) {
    const list = useValue(watcher.notes)
    const t = usePluginI18n(ID)
    if (!sessionId || !list.some(n => n.storedId === sessionId)) return null
    const label = t('ysk.dotLabel')
    return jsx('span', { className: 'ysk-dot', 'data-ysk': 'dot', role: 'img', 'aria-label': label, title: label })
  }
}

export default {
  id: ID,
  name: 'You Should Know',
  register(ctx) {
    ctx.i18n.register({ en })
    const watcher = createWatcher(ctx)
    watcher.capture()
    const unlisten = [host.state.focusedSessionId.listen(watcher.noteFocus), host.state.focusedStoredSessionId.listen(watcher.noteFocus)]
    ctx.onDispose(() => unlisten.forEach(fn => fn?.()))
    ctx.onEvent('message.complete', event => void watcher.onComplete(event))
    ctx.register({ id: 'headline', area: COMPOSER_AREAS.top, render: createStrip(watcher) })
    ctx.register({ id: 'dot', area: SESSION_ROW_AREAS.trailing, data: { render: createDot(watcher) } })
  }
}
