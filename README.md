# You Should Know

A Hermes plugin. After a long reply (3,000+ characters) in a chat you opened in the desktop app, a
second model (Opus) reads the reply and lifts what you must not miss — a cost, a step that cannot be
undone, a security risk, something you have to do, an assumption, a deadline — into a notice that
stays until you dismiss it. When there is nothing to flag, nothing is shown.

Each check costs about two cents and is recorded (without any text) in a ledger. See
`Docs/you-should-know-notes.md` for how it works, the cost and the one-week review.

## Layout

| Path | What |
|---|---|
| `desktop/plugin.js` | Desktop half: picks replies, calls the backend, shows the notice |
| `dashboard/plugin_api.py` | Backend: `POST /check`, the model call, the ledger |
| `plugin.yaml`, `dashboard/manifest.json`, `__init__.py` | Hermes plugin metadata |
| `tests/` | Gates (below) |

## Install

1. Clone this repository into `<HERMES_HOME>/plugins/you-should-know` and check out a release tag.
2. Copy `desktop/plugin.js` to `<HERMES_HOME>/desktop-plugins/you-should-know/plugin.js`.
3. Restart the desktop app (the backend route mounts at start).

## Gates

Run from `tests/`; every one exits 0 when it passes.

| Gate | Command |
|---|---|
| Desktop half | `node render_check.mjs` |
| Backend | `python check_api.py` |
| Static rules | `python audit_static.py` |
| Core contract | `python contract_core.py` and `python contract_core.py --selftest` |
| Canary | `python canary_audit.py` |

`check_api.py` needs FastAPI (the Hermes venv has it) and calls no model. `contract_core.py` reads a
Hermes checkout (`--core`, `HERMES_CORE`, or `<HERMES_HOME>/hermes-agent`). CI runs every gate on
Ubuntu and Windows against a pinned core revision (`CORE_SHA` in `.github/workflows/ci.yml`).

## License

MIT — see `LICENSE`.
