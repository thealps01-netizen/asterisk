# You Should Know

A Hermes plugin. After a long reply (3,000+ characters) in a chat you opened in the desktop app, a
second model (Opus) rereads that whole turn — your message, the assistant's tool calls and their
results, and the reply — and, only when there is one, names the one thing the reply did not plainly
tell you: an unstated tradeoff, a result that may be off, a silent assumption, an understated
irreversible step, a security risk or a cost, and who decided it (the assistant or you). It shows as a
headline above the input that stays until you dismiss it. Most turns have nothing to flag; then
nothing is shown.

Each check costs about 5 cents: measured on 14 real turns from one user (2026-10-17), the mean was
about $0.05 and the range about $0.02–0.08, against about $0.019 for 1.0.0 on the same turns. At ~15
checks a day that is about $22 a month. Each check is recorded (without any text) in a ledger. See
`Docs/you-should-know-notes.md` for how it works, the cost and the review.

## Layout

| Path | What |
|---|---|
| `desktop/plugin.js` | Desktop half: picks replies, calls the backend, shows the headline strip above the input and the sidebar dot |
| `dashboard/plugin_api.py` | Backend: `POST /check`, `POST /feedback`, reading the turn, redaction and caps, the model call, the ledger |
| `eval/compare_checkers.py` | Offline evaluation: 1.0.0 against this checker on past turns (opt-in, below) |
| `plugin.yaml`, `dashboard/manifest.json`, `__init__.py` | Hermes plugin metadata |
| `tests/` | Gates (below) |

## Install

Needs Hermes v0.21.6 or later (its `message.complete` frames carry the turn's row ids).

1. Clone this repository into `<HERMES_HOME>/plugins/you-should-know` and check out a release tag.
2. Copy `desktop/plugin.js` to `<HERMES_HOME>/desktop-plugins/you-should-know/plugin.js`. The desktop
   half and the backend must come from the same release (2.0.0 changed the request between them).
3. Restart the desktop app (the backend route mounts at start).

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
the latest long-reply turns of sessions you name, and writes a markdown with both answers, their cost
and a "useful / noise" box per point for you to tick.

- A live run spends money: two Opus calls per turn. Nothing runs it on its own — not CI, not an agent.
- `--dry-run` calls no model and writes nothing; it prints each turn's sizes and an estimate of the
  input tokens. Start there.
- Run it from the repository root with any Python that can start Hermes (the Hermes venv interpreter
  does): `python eval/compare_checkers.py --session <stored id> [--turns 3] [--dry-run]`. It starts
  Hermes itself first, from the core checkout it finds by `--core <path>`, `HERMES_CORE`, or
  `<HERMES_HOME>/hermes-agent`; no `PYTHONPATH` is needed.
- The markdown goes to `<HERMES_HOME>/state/you-should-know/eval/` (or `--out`; a path inside this
  repository is refused). It holds text from your conversations: never commit it.

## License

MIT — see `LICENSE`.
