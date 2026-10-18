# Asterisk

Asterisk is a Hermes plugin. After a turn in a chat you opened in the desktop app where the assistant
used a tool that can change something (wrote a file, ran a command, ...), or wrote a long reply
(3,000+ characters), a second model (the model you choose for it) rereads that whole turn — your
message, the assistant's tool calls and their results, and the reply, with your last earlier messages
in the chat as context — and, only when there is one, names the one thing the reply did not plainly
tell you: an unstated tradeoff, a result that may be off, a silent assumption, an understated
irreversible step, a security risk, a cost, a request left unanswered, work claimed but not done,
something you said not to do that was done, or something you did not ask for, and who decided it
(the assistant or you). It shows as a headline above the input that stays until you dismiss it. Most
turns have nothing to flag; then nothing is shown.

Each check costs about 5 cents on `claude-opus-5-5`: measured on 14 real turns from one user
(2026-10-17), the mean was about $0.05 and the range about $0.02–0.08, against about $0.019 for 1.0.0
on the same turns. On one user's history (30 days, 4 active days, 403 turns, counts only) the 4.0.0
rule checked about 14 turns per active day (~$0.74) and this rule about 75 (~$4.0 at 5.3 cents a
check); what a short-reply check costs is not measured. Other models are not measured: the cost and
the quality of the points on them are unknown. Each check, and each skipped turn, is recorded
(without any text) in a ledger. See `Docs/asterisk-notes.md` for how it works, the cost and the
review.

## Layout

| Path | What |
|---|---|
| `desktop/plugin.js` | Desktop half: picks replies, calls the backend, shows the headline strip above the input and the sidebar dot |
| `dashboard/plugin_api.py` | Backend: `POST /check`, `POST /feedback`, `POST /status`, reading the turn, redaction and caps, the model call, the ledger |
| `eval/compare_checkers.py` | Offline evaluation: 1.0.0 against this checker on past turns (opt-in, below) |
| `plugin.yaml`, `dashboard/manifest.json`, `__init__.py` | Hermes plugin metadata |
| `tests/` | Gates (below) |

## Install

Needs Hermes v0.21.6 or later (its `message.complete` frames carry the turn's row ids). In the Hermes
app, no terminal:

1. Open Capabilities → Plugins and click **Install from Git**.
2. Paste `https://github.com/thealps01-netizen/asterisk`.
3. Click **Review repository**, then **Install**.
4. On Hermes v0.21.6 only: switch on the Desktop half of the Asterisk row if it is off.
5. Choose the model Asterisk checks with: Settings → Models → Auxiliary models → the Asterisk row →
   Change (or Set to main). Until then it checks nothing and says so once per app start.

In a terminal instead: `hermes plugins install thealps01-netizen/asterisk --enable`, then switch on
the Desktop half in Capabilities → Plugins, then choose the model as in step 5.

## Update

Capabilities → Plugins → the Asterisk row's **Update** button (shown when a newer commit is on
GitHub). An install pinned to a commit updates only by installing again with a new pin.

From 3.0.0: choose a model once as in Install step 5; 3.0.0 always used `claude-opus-5-5` on
`anthropic`.

## Upgrading from 2.x (You Should Know)

1. Capabilities → Plugins → the `you-should-know` row → **Uninstall**, and confirm.
2. Install Asterisk as in "Install" above.
3. Nothing else: the first check copies the 2.x ledger over.

Do not use the 2.x row's Update button for this: it keeps the old folder name, and Asterisk stays
off. The earlier evaluation files stay in `state/you-should-know/eval/`. `state/you-should-know/` is
left as it was; you may delete it by hand later. In a terminal: `hermes plugins remove you-should-know`,
then the install line above.

## Gates

Run from `tests/`; every one exits 0 when it passes. Run `npm ci` in `tests/` once first: the desktop
half is rendered with real React and jsdom, pinned to the core desktop app's versions.

| Gate | Command |
|---|---|
| Desktop half | `node render_check.mjs` |
| Backend | `python check_api.py` |
| Static rules | `python audit_static.py` |
| Core contract | `python contract_core.py` and `python contract_core.py --selftest` |
| Canary | `python canary_audit.py` |

`check_api.py` needs FastAPI (the Hermes venv has it) and calls no model. `contract_core.py` and
`audit_static.py` read a Hermes checkout (`--core`, `HERMES_CORE`, or `<HERMES_HOME>/hermes-agent`).
CI runs every gate on Ubuntu and Windows against a pinned core revision (`CORE_SHA` in
`.github/workflows/ci.yml`).

For a reviewer's eyes, `node preview_strip.mjs` writes light and dark previews of the strip
(`tests/.out/preview/{nous,everforest}-{light,dark}.html`) in the app's own CSS. It needs a built core
desktop app (`apps/desktop/dist`), starts no app, and is not a gate.

## Offline evaluation

`eval/compare_checkers.py` runs the 1.0.0 checker (the reply alone) and this one (the whole turn) on
the latest turns Asterisk would check of sessions you name, and writes a markdown with both answers, their cost
and a "useful / noise" box per point for you to tick.

- A live run spends money: one Opus call (1.0.0) and one call on the model chosen for Asterisk per
  turn. Nothing runs it on its own — not CI, not an agent. With no model chosen for Asterisk it stops
  before any call.
- `--dry-run` calls no model and writes nothing; it prints each turn's sizes and an estimate of the
  input tokens. Start there.
- Run it from the repository root with any Python that can start Hermes (the Hermes venv interpreter
  does): `python eval/compare_checkers.py --session <stored id> [--turns 3] [--dry-run]`. It starts
  Hermes itself first, from the core checkout it finds by `--core <path>`, `HERMES_CORE`, or
  `<HERMES_HOME>/hermes-agent`; no `PYTHONPATH` is needed.
- The markdown goes to `<HERMES_HOME>/state/asterisk/eval/` (or `--out`; a path inside this
  repository is refused). It holds text from your conversations: never commit it.

## License

MIT — see `LICENSE`.
