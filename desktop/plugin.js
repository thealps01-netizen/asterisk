/**
 * You Should Know — lifts what a long reply must not let slip into a notice the user cannot miss.
 *
 * When a reply of a chat the user has opened in this app finishes (`message.complete`, status
 * complete, a new reply, at least MIN_CHARS long), the backend asks a second model (Opus) what in it
 * the user must not miss: a cost, an irreversible step, a security risk, an action of theirs, an
 * assumption, a deadline. Nothing to flag -> nothing shown (the common case). Otherwise one warning
 * notice that stays until dismissed: the first point as its message, the others as its detail, what
 * the check cost as its meta, and "Open chat" when the reply is not in the focused chat. With a
 * Hermes pet on screen it also says so in its bubble.
 *
 * Each reply is checked once. A failed check is one error notice, named, never swallowed.
 * The plugin draws nothing of its own and writes nothing: the backend keeps a cost ledger with no
 * reply text in it (see Docs/you-should-know-notes.md).
 */
import { host } from '@hermes/plugin-sdk'

const ID = 'you-should-know'
export const MIN_CHARS = 3000
const SEEN_MAX = 500
const CHECKED_MAX = 300

const en = {
  ysk: {
    title: 'You should know',
    kind: {
      cost: 'Cost',
      irreversible: 'Cannot be undone',
      security: 'Security',
      action: 'Your move',
      assumption: 'Assumption',
      deadline: 'Deadline'
    },
    point: (kind, text) => `${kind}: ${text}`,
    meta: cost => (cost ? `Checked by Opus · ${cost}` : 'Checked by Opus'),
    open: 'Open chat',
    failed: detail => `Could not check a long reply: ${detail}`,
    pet: count => `You should know: ${count} point${count === 1 ? '' : 's'} in the notice`
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

/** The notice for a check's points; null when there is nothing to flag. */
export function noticeFor(result, { key, storedId, focusedStoredId, open }) {
  const points = Array.isArray(result?.points) ? result.points.filter(p => p && typeof p.text === 'string' && p.text) : []
  if (!points.length) return null
  const line = p => (en.ysk.kind[p.kind] ? t('ysk.point', en.ysk.kind[p.kind], p.text) : p.text)
  const away = Boolean(storedId) && storedId !== focusedStoredId
  return {
    id: `${ID}-${key}`,
    kind: 'warning',
    title: t('ysk.title'),
    message: line(points[0]),
    detail: points.slice(1).map(p => `• ${line(p)}`).join('\n') || undefined,
    meta: t('ysk.meta', fmtCost(result.cost_usd, result.cost_status)),
    action: away ? { label: t('ysk.open'), onClick: () => open(storedId) } : undefined
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
    let result
    try {
      result = await ctx.rest('/check', { method: 'POST', body: { text: payload.text } })
    } catch (err) {
      const detail = String(err?.message || err)
      console.warn(`[${ID}] check failed`, err)
      hostApi.notify({ id: `${ID}-error`, kind: 'error', title: t('ysk.title'), message: t('ysk.failed', detail) })
      return
    }
    const notice = noticeFor(result, {
      key,
      storedId: seen.get(sid),
      focusedStoredId: hostApi.state.focusedStoredSessionId.get(),
      open: storedId => void hostApi.openSession(storedId)
    })
    if (!notice) return
    hostApi.notify(notice)
    if (ctx.pet?.visible?.get?.()) ctx.pet.say(t('ysk.pet', result.points.length), { id: ID, tone: 'info' })
  }

  return { capture, noteFocus, onComplete, seen, checked }
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
  }
}
