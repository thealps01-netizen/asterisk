"""Asterisk — offline evaluation: the 1.0.0 checker (reply only, up to three points) against the
turn-aware checker (the whole turn, one point or none), on real past turns Asterisk would check, of
chosen sessions.

Run from the repository root with any Python that can start Hermes (the Hermes venv interpreter does):
  python eval/compare_checkers.py --session <stored id> [--session ...] [--turns 3] [--core <checkout>]
                                  [--old <1.0.0 plugin_api.py>] [--out <file.md>] [--dry-run]

Its first step is Hermes' own start-up: it finds the core checkout (--core, HERMES_CORE, or
<HERMES_HOME>/hermes-agent — the convention tests/contract_core.py uses), puts it first on sys.path
and imports hermes_bootstrap, before it loads any plugin code. The bootstrap activates the core's
dependencies (FastAPI among them) and may relaunch this script under Hermes' managed runtime; the
relaunched run prints the output. Without this, an old editable install in the venv misses newer core
modules, and the backend's FastAPI import fails before the dependencies are active.

A LIVE run spends money: one Opus call (1.0.0) and one call on the model chosen for Asterisk per turn. It is
never run by CI or by an agent on its own. A live run with no model chosen for Asterisk stops (exit 2) before
anything is fetched, called or written. `--dry-run` calls no model, needs no network and writes no file: it
prints each turn's sizes and an ESTIMATE of the new checker's input tokens (characters / 2.5).

What it reads: the profile's session store, read-only (the same chain as the plugin's backend).
What it writes (live only): one markdown file, by default under
<HERMES_HOME>/state/asterisk/eval/, with each turn's points and a "useful / noise" box per
point for a person to tick. That file holds text taken from the conversations: it stays under
HERMES_HOME, a path inside this repository is refused, and it is never committed.
Neither checker's check() is called, so the plugin's ledger is never written.
"""
from __future__ import annotations

import argparse
import importlib
import importlib.util
import os
import subprocess
import sys
import tempfile
import time
import types
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
NEW_API = REPO / "dashboard" / "plugin_api.py"
STORE_LIMIT = 2000
CHARS_PER_TOKEN = 2.5


def default_core() -> Path:
    """The core checkout, found as tests/contract_core.py finds it."""
    if os.environ.get("HERMES_CORE"):
        return Path(os.environ["HERMES_CORE"])
    base = Path(os.environ["HERMES_HOME"]) if os.environ.get("HERMES_HOME") else (
        Path(os.environ["LOCALAPPDATA"]) / "hermes" if os.environ.get("LOCALAPPDATA") else Path.home() / ".hermes")
    return base / "hermes-agent"


def bootstrap(core: Path) -> None:
    """Start the core the way Hermes' entry points do: its root first on sys.path, then hermes_bootstrap
    (which may relaunch this script under the managed runtime and exit with the child's status)."""
    if not (core / "hermes_bootstrap.py").is_file():
        raise SystemExit(f"compare_checkers: no Hermes core at {core}; pass --core or set HERMES_CORE")
    sys.path.insert(0, str(core))
    importlib.import_module("hermes_bootstrap")


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def old_source(tmp: Path) -> Path:
    """1.0.0's backend from this repository's v1.0.0 tag, in a temp file."""
    done = subprocess.run(["git", "-C", str(REPO), "show", "v1.0.0:dashboard/plugin_api.py"],
                          capture_output=True, text=True, encoding="utf-8")
    if done.returncode != 0:
        raise SystemExit("compare_checkers: the v1.0.0 tag is missing here; fetch the tags or pass --old <path>")
    path = tmp / "plugin_api_1_0_0.py"
    path.write_text(done.stdout, encoding="utf-8")
    return path


def eligible_turns(new, session_id: str, count: int) -> list[dict]:
    """The latest `count` turns of a session that Asterisk would check (the backend's needs_check), each as a receipt."""
    from hermes_state import SessionDB
    db = SessionDB(read_only=True)
    try:
        resolved = db.resolve_session_id(session_id)
        if not resolved:
            raise SystemExit(f"compare_checkers: session {session_id!r} not found")
        sid = db.resolve_resume_session_id(resolved)
        rows = db.get_messages(sid, latest=True, limit=STORE_LIMIT, include_ancestors=True)
    finally:
        db.close()
    # A turn: a user row through the last assistant row without tool calls before the next user row.
    segments: list[list[dict]] = []
    for row in rows:
        if row.get("role") == "user":
            segments.append([row])
        elif segments:
            segments[-1].append(row)
    out = []
    for seg in segments:
        finals = [i for i, r in enumerate(seg) if r.get("role") == "assistant" and not r.get("tool_calls")]
        if not finals:
            continue
        kept = seg[:finals[-1] + 1]
        reply = new._text(kept[-1].get("content"))
        if new.needs_check(kept):
            ids = [r["id"] for r in kept]
            out.append({"session": session_id, "reply": reply,
                        "receipt": {"row_ids": ids, "complete": True, "user_row_id": ids[0],
                                    "final_assistant_row_id": ids[-1]}})
    return out[-count:]


def dry_call(messages, route=None):
    """The dry run's model: no network, always nothing to flag."""
    return types.SimpleNamespace(dry_answer='{"points": []}', usage=None)


def ask(module, messages, new: bool = False):
    """One side's answer: (points or an error name, cost text). The new checker reports the route that answered."""
    route: dict = {}
    try:
        response = module._call_llm(messages, route) if new else module._call_llm(messages)
    except Exception as exc:  # noqa: BLE001 — one failed side does not end the run
        return f"model call failed ({type(exc).__name__})", "n/a"
    raw = getattr(response, "dry_answer", None)
    try:
        points = module._parse(raw if raw is not None else module._content(response))
    except (ValueError, TypeError) as exc:
        points = f"unreadable answer ({type(exc).__name__})"
    if raw is not None:
        return points, "dry run"
    tokens_in, tokens_out, usd, status = module._cost(response, route) if new else module._cost(response)
    on = f", {route.get('model')}" if new else ""
    return points, f"{tokens_in} in / {tokens_out} out, {'n/a' if usd is None else f'${usd:.4f}'} ({status}{on})"


def compare(new, old, turn: dict) -> dict:
    rows, earlier = new.read_turn(turn["session"], turn["receipt"])
    turn_text, stats = new.build_turn(rows)
    earlier_text = new.build_earlier(earlier)
    old_reply = old._clip(new._redact(turn["reply"]))
    old_messages = [{"role": "system", "content": old.SYSTEM_PROMPT},
                    {"role": "user", "content": f"The reply:\n\n{old_reply}"}]
    ids = turn["receipt"]["row_ids"]
    return {"session": turn["session"], "rows": f"{ids[0]}-{ids[-1]}", "old_chars": len(old_reply),
            "new_turn_chars": stats["turn_chars"], "earlier_chars": len(earlier_text), "tool_results": stats["tool_results"],
            "truncated": stats["truncated"], "est_tokens": round((stats["turn_chars"] + len(earlier_text)) / CHARS_PER_TOKEN),
            "old": ask(old, old_messages), "new": ask(new, new.build_messages(turn_text, earlier_text), new=True)}


def point_lines(points) -> list[str]:
    if isinstance(points, str):
        return [f"- {points}"]
    if not points:
        return ["- none"]
    lines = []
    for p in points:
        who = f", by {p['by']}" if p.get("by") else ""
        head = f"{p['headline']} — " if p.get("headline") else ""
        lines += [f"- **{p['kind']}**{who}: {head}{p['text']}", "  - [ ] useful  - [ ] noise"]
    return lines


def markdown(results: list[dict]) -> str:
    out = [f"# Asterisk — checker comparison ({time.strftime('%Y-%m-%d %H:%M')})", "",
           "Conversation-derived text: keep this file under HERMES_HOME, never commit it.", ""]
    for r in results:
        out += [f"## {r['session']} rows {r['rows']}", "",
                f"Sizes: old reply {r['old_chars']} chars; new turn {r['new_turn_chars']} chars, "
                f"earlier messages {r['earlier_chars']} chars, "
                f"{r['tool_results']} tool results, truncated {r['truncated']}.", "",
                f"### Old (1.0.0) — {r['old'][1]}", *point_lines(r["old"][0]), "",
                f"### New (turn-aware) — {r['new'][1]}", *point_lines(r["new"][0]), ""]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare the 1.0.0 checker with the turn-aware one on past turns.")
    parser.add_argument("--session", action="append", required=True, help="a stored session id (repeatable)")
    parser.add_argument("--turns", type=int, default=3, help="latest N eligible turns per session (default 3)")
    parser.add_argument("--old", type=Path, help="a 1.0.0 plugin_api.py (default: v1.0.0 from this repo)")
    parser.add_argument("--out", type=Path, help="the markdown to write (default under HERMES_HOME)")
    parser.add_argument("--dry-run", action="store_true", help="no model, no network, no file: print sizes only")
    parser.add_argument("--core", type=Path, default=default_core(),
                        help="the Hermes core checkout (default: HERMES_CORE, else <HERMES_HOME>/hermes-agent)")
    args = parser.parse_args(argv)

    bootstrap(args.core)
    new = load(NEW_API, "asterisk_eval_new")
    if not args.dry_run and new._chosen_route() is None:
        print("compare_checkers: no model chosen for Asterisk (Settings → Models → Auxiliary models)", file=sys.stderr)
        return 2
    out = args.out or (new._home() / "state" / new.PLUGIN_ID / "eval" / f"compare-{time.strftime('%Y%m%d-%H%M%S')}.md")
    if out.resolve().is_relative_to(REPO):
        print(f"compare_checkers: refusing to write inside the repository ({out}); the file holds conversation text",
              file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix="asterisk-eval-") as tmp:
        old = load(args.old or old_source(Path(tmp)), "asterisk_eval_old")
    if args.dry_run:
        new._call_llm = old._call_llm = dry_call

    results = []
    for session_id in args.session:
        for turn in eligible_turns(new, session_id, args.turns):
            try:
                results.append(compare(new, old, turn))
            except (new.TurnUnreadable, new.TurnSkipped, new.RedactionUnavailable) as exc:
                print(f"session={session_id} skipped: {type(exc).__name__} ({exc})", file=sys.stderr)
    for r in results:
        print(f"session={r['session']} rows={r['rows']} old_chars={r['old_chars']} new_turn_chars={r['new_turn_chars']} "
              f"earlier_chars={r['earlier_chars']} tool_results={r['tool_results']} truncated={r['truncated']} "
              f"est_tokens={r['est_tokens']} (estimate: chars / 2.5)")
    print(f"{len(results)} turn(s)")
    if args.dry_run:
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(markdown(results), encoding="utf-8")
    print(f"written: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
