/**
 * Asterisk — a light/dark preview of the "Worth knowing" strip, for a reviewer's eyes.
 * Not a gate, not run by CI, starts no app.
 *
 * Run: npm ci      (once, in tests/)
 *      node preview_strip.mjs [path/to/plugin.js]
 * Writes tests/.out/preview/{nous,everforest}-{light,dark}.html. Open them in a browser.
 *
 * Each page renders the plugin's real components (react-dom/server, the same SDK stub idea as
 * render_check.mjs) inside the core desktop app's compiled CSS (apps/desktop/dist/assets/index-*.css,
 * inlined), with the preset's seeds set on <html> the way the app's applyTheme maps them (palette
 * read at run time from apps/shared/src/theme-presets.ts), and class="dark" + color-scheme for dark.
 * It shows, in order: "One note, focused chat (Ask in chat)", "One note, another chat", "Three notes,
 * one in the focused chat", "Three notes, collapsed", "One note, collapsed", "Three notes, reduced
 * motion", "One note, another chat, narrow (260px)" and "Three notes, one in the focused chat, narrow
 * (260px)" (a 260px composer, the core's COMPOSER_FOLD_VOICE_PX), beside a sidebar of five rows with
 * dots on three. One note's sentence carries a long unbreakable path.
 *
 * Fit report: an inline script sets <body data-fit> to "ok", or to the list of failures. For every
 * actions row: no horizontal overflow, every button ends inside the row (0.5px tolerance), all its
 * buttons share one height (no label wraps inside a button) and, outside the narrow sections, one
 * line; for every entry: no horizontal overflow. At 260px the row may wrap onto more lines.
 * Read it in a browser: document.body.dataset.fit.
 *
 * Core from HERMES_CORE or <HERMES_HOME>/hermes-agent. A missing core, a missing dist CSS (build the
 * desktop app first) or an unparseable palette exits 1 naming the path.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = process.argv[2] ? path.resolve(process.argv[2]) : path.join(HERE, '..', 'desktop', 'plugin.js')
const OUT = path.join(HERE, '.out', 'preview')
const NM = path.join(HERE, 'node_modules')
const fail = msg => {
  console.log(`FAIL  ${msg}`)
  process.exit(1)
}
if (!['react', 'react-dom'].every(p => existsSync(path.join(NM, p, 'package.json')))) fail(`React missing in ${NM} — run \`npm ci\` in tests/ first`)

const home = process.env.HERMES_HOME || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'hermes') : path.join(os.homedir(), '.hermes'))
const CORE = path.resolve(process.env.HERMES_CORE || path.join(home, 'hermes-agent'))
const ASSETS = path.join(CORE, 'apps', 'desktop', 'dist', 'assets')
const PRESETS = path.join(CORE, 'apps', 'shared', 'src', 'theme-presets.ts')
if (!existsSync(CORE)) fail(`no core at ${CORE} (set HERMES_CORE)`)
const cssFile = existsSync(ASSETS) ? readdirSync(ASSETS).find(f => /^index-.*\.css$/.test(f)) : null
if (!cssFile) fail(`no compiled CSS ${path.join(ASSETS, 'index-*.css')} — build the core desktop app first`)
if (!existsSync(PRESETS)) fail(`no theme presets at ${PRESETS}`)
const appCss = readFileSync(path.join(ASSETS, cssFile), 'utf8')
const presetsSrc = readFileSync(PRESETS, 'utf8')

/** `<name>: { colors: {...}, darkColors: {...} }` from theme-presets.ts, as two flat maps. */
function palette(name) {
  const start = presetsSrc.search(new RegExp(`^  ${name}: \\{$`, 'm'))
  const block = (from, key) => {
    const at = presetsSrc.indexOf(`${key}: {`, from)
    const end = presetsSrc.indexOf('}', at)
    if (at < 0 || end < 0) return null
    const map = Object.fromEntries([...presetsSrc.slice(at, end).matchAll(/(\w+):\s*'([^']+)'/g)].map(m => [m[1], m[2]]))
    return Object.keys(map).length ? map : null
  }
  const light = start >= 0 ? block(start, 'colors') : null
  const dark = start >= 0 ? block(start, 'darkColors') : null
  if (!light?.background || !light?.foreground || !dark?.background || !dark?.foreground) fail(`could not parse the ${name} palette in ${PRESETS}`)
  return { light, dark }
}

/** The vars the app's applyTheme sets inline on <html> that come straight from the palette. */
function seeds(c, isDark) {
  const midground = c.midground ?? c.ring
  return {
    '--theme-foreground': c.foreground,
    '--theme-primary': c.primary,
    '--theme-secondary': c.secondary,
    '--theme-accent-soft': c.accent,
    '--theme-midground': midground,
    '--theme-warm': c.primary,
    '--theme-background-seed': c.background,
    '--theme-sidebar-seed': c.sidebarBackground ?? c.background,
    '--theme-card-seed': c.card,
    '--theme-elevated-seed': c.popover,
    '--theme-bubble-seed': c.userBubble ?? c.popover,
    '--theme-mix-chrome': isDark ? '74%' : '92%',
    '--theme-mix-sidebar': '100%',
    '--theme-mix-card': isDark ? '38%' : '22%',
    '--theme-mix-elevated': isDark ? '46%' : '28%',
    '--theme-mix-bubble': isDark ? '46%' : '0%',
    '--dt-primary-foreground': c.primaryForeground,
    '--dt-secondary-foreground': c.secondaryForeground,
    '--dt-accent-foreground': c.accentForeground,
    '--dt-border': c.border,
    '--dt-input': c.input,
    '--dt-ring': c.ring,
    '--dt-muted': c.muted,
    '--dt-composer-ring': c.composerRing ?? midground,
    '--dt-destructive': c.destructive,
    '--dt-destructive-foreground': c.destructiveForeground,
    '--dt-sidebar-border': c.sidebarBorder ?? c.border,
    '--dt-user-bubble-border': c.userBubbleBorder ?? c.border
  }
}

// ── the plugin, with a stub SDK ─────────────────────────────────────────────
mkdirSync(path.join(OUT, 'src'), { recursive: true })
const anchor = JSON.stringify(path.join(HERE, 'package.json'))
writeFileSync(path.join(OUT, 'src', 'react-jsx.mjs'), `import { createRequire } from 'node:module'
const m = createRequire(${anchor})('react/jsx-runtime')
export const jsx = m.jsx, jsxs = m.jsxs, Fragment = m.Fragment
`)
writeFileSync(path.join(OUT, 'src', 'sdk-stub.mjs'), `import { createRequire } from 'node:module'
const React = createRequire(${anchor})('react')
export function atom(v) {
  const views = new Set()
  return { get: () => v, set: n => { v = n; views.forEach(f => f()) }, listen: () => () => {}, view: f => { views.add(f); return () => views.delete(f) } }
}
export const useValue = a => React.useSyncExternalStore(a.view, a.get, a.get)
export const i18n = { bundle: null }
export function usePluginI18n() {
  return (key, ...args) => {
    let node = i18n.bundle?.en
    for (const part of key.split('.')) node = node?.[part]
    return typeof node === 'function' ? node(...args) : typeof node === 'string' ? node : key
  }
}
export const COMPOSER_AREAS = { top: 'composer.top' }
export const SESSION_ROW_AREAS = { trailing: 'sessionRow.trailing' }
export const host = {
  state: { focusedSessionId: atom('rt-1'), focusedStoredSessionId: atom('st-1') },
  notify() {}, openSession: async () => {},
  composer: { insertText: async () => true }
}
`)
const href = f => `'${pathToFileURL(path.join(OUT, 'src', f)).href}'`
writeFileSync(path.join(OUT, 'src', 'plugin.mjs'),
  readFileSync(SRC, 'utf8').replace("'@hermes/plugin-sdk'", href('sdk-stub.mjs')).replace("'react/jsx-runtime'", href('react-jsx.mjs')))
const stub = await import(pathToFileURL(path.join(OUT, 'src', 'sdk-stub.mjs')).href)
const mod = await import(pathToFileURL(path.join(OUT, 'src', 'plugin.mjs')).href)
const require = createRequire(path.join(HERE, 'package.json'))
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const registered = []
const ctx = {
  register: c => registered.push(c),
  i18n: { register: b => { stub.i18n.bundle = b } },
  onEvent() {}, onDispose() {}, rest: async p => (p === '/notes' ? { notes: [] } : {})
}
mod.default.register(ctx)
// The watcher is private to register(); a fresh one per state gives each section its own notes.
const NOTES = [
  { id: 'n1', storedId: 'st-1', title: 'Deploy plan', headline: 'SQLite chosen over Postgres',
    text: 'The assistant chose SQLite over Postgres without saying it drops concurrent writes.', by: 'assistant', cost: '~$0.04', checkAt: 1 },
  { id: 'n2', storedId: 'st-2', title: null, headline: 'Old backups deleted for good',
    text: 'You asked to delete the old backups; the reply calls it a cleanup, but they cannot be restored.', by: 'user', cost: '<$0.01', checkAt: 2 },
  { id: 'n3', storedId: 'st-3', title: 'Release notes for the spring update', headline: 'Release tag pushed before the tests finished',
    text: 'The assistant pushed the release tag while the test run was still going; its log is in build/release_candidate_2026_10_18_spring_update_full_test_run_output.log.', by: 'assistant', cost: '~$0.06', checkAt: 3 }
]
const watcherWith = (list, { folded = false } = {}) => {
  const w = mod.createWatcher(ctx, stub.host)
  w.notes.set(list)
  w.folded.set(folded)
  return w
}
const strip = (list, opts) => renderToStaticMarkup(createElement(mod.createStrip(watcherWith(list, opts))))
const reduced = list => {
  const saved = globalThis.window
  globalThis.window = { matchMedia: q => ({ matches: q.includes('reduce') }) }
  try { return strip(list) } finally { globalThis.window = saved }
}
const sidebar = () => {
  const w = watcherWith([NOTES[0], NOTES[1], NOTES[2]])
  const DotFor = mod.createDot(w)
  const rows = [['st-1', 'Deploy plan'], ['st-4', 'Weekly review'], ['st-2', 'Untitled chat'], ['st-5', 'Grocery list'], ['st-3', 'Release notes for the spring update']]
  return rows.map(([id, name]) => `<div class="pv-row"><span class="pv-name">${name}</span>${renderToStaticMarkup(createElement(DotFor, { sessionId: id }))}</div>`).join('')
}

const section = (title, body, narrow = false) => `<section class="pv-case${narrow ? ' pv-narrow' : ''}"><h2 class="pv-h">${title}</h2><div class="pv-composer">${body}<div class="pv-input">Ask anything…</div></div></section>`
// The fit report (see the header): what the reviewer reads as document.body.dataset.fit.
const FIT = `(() => {
  const fails = []
  for (const sec of document.querySelectorAll('.pv-case')) {
    const name = sec.querySelector('.pv-h').textContent
    const narrow = sec.classList.contains('pv-narrow')
    sec.querySelectorAll('.asterisk-actions').forEach((row, i) => {
      const where = name + ' / actions ' + (i + 1)
      const right = row.getBoundingClientRect().right
      const btns = [...row.querySelectorAll('.asterisk-btn')]
      if (row.scrollWidth > row.clientWidth) fails.push(where + ': the row overflows')
      if (btns.some(b => b.getBoundingClientRect().right > right + 0.5)) fails.push(where + ': a button ends past the row')
      if (new Set(btns.map(b => b.offsetHeight)).size > 1) fails.push(where + ': a label wraps inside a button')
      if (!narrow && new Set(btns.map(b => b.offsetTop)).size > 1) fails.push(where + ': the buttons take more than one line')
    })
    sec.querySelectorAll('.asterisk-entry').forEach((e, i) => {
      if (e.scrollWidth > e.clientWidth) fails.push(name + ' / entry ' + (i + 1) + ': the entry overflows')
    })
  }
  document.body.dataset.fit = fails.length ? fails.join('; ') : 'ok'
})()`
for (const name of ['nous', 'everforest']) {
  const { light, dark } = palette(name)
  for (const [mode, c] of [['light', light], ['dark', dark]]) {
    const isDark = mode === 'dark'
    const vars = Object.entries(seeds(c, isDark)).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('; ')
    const html = `<!doctype html>
<html${isDark ? ' class="dark"' : ''} lang="en" data-hermes-theme="${name}" data-hermes-mode="${mode}" style="color-scheme: ${mode}; ${vars}">
<head><meta charset="utf-8"><title>Worth knowing — ${name} ${mode}</title>
<style>${appCss}</style>
<style>
body{margin:0;padding:24px;background:var(--ui-bg, var(--theme-background-seed));color:var(--ui-text-primary);font-family:var(--font-sans)}
.pv-grid{display:grid;grid-template-columns:240px minmax(0,640px);gap:28px;align-items:start}
.pv-h{font-size:11px;font-weight:600;margin:0 0 8px;color:var(--ui-text-tertiary)}
.pv-case{margin-bottom:28px}
.pv-composer{border:1px solid var(--ui-stroke-secondary);border-radius:14px;overflow:hidden}
.pv-input{padding:14px;font-size:13px;color:var(--ui-text-tertiary)}
.pv-side{display:flex;flex-direction:column;gap:2px}
.pv-row{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;font-size:13px}
.pv-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-narrow .pv-composer{width:260px}
</style></head>
<body><div class="pv-grid">
<aside><h2 class="pv-h">Sidebar (dots on three chats)</h2><div class="pv-side">${sidebar()}</div></aside>
<main>
${section('One note, focused chat (Ask in chat)', strip([NOTES[0]]))}
${section('One note, another chat', strip([NOTES[2]]))}
${section('Three notes, one in the focused chat', strip(NOTES))}
${section('Three notes, collapsed', strip(NOTES, { folded: true }))}
${section('One note, collapsed', strip([NOTES[0]], { folded: true }))}
${section('Three notes, reduced motion', reduced(NOTES))}
${section('One note, another chat, narrow (260px)', strip([NOTES[2]]), true)}
${section('Three notes, one in the focused chat, narrow (260px)', strip(NOTES), true)}
</main></div><script>${FIT}</script></body></html>
`
    const file = path.join(OUT, `${name}-${mode}.html`)
    writeFileSync(file, html)
    console.log(`wrote ${file}`)
  }
}
