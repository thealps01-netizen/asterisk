"""You Should Know — canary: break the plugin on purpose, one way at a time, and require a gate to fail.

Run: python canary_audit.py      (exit 0 = every mutation was caught)

Each mutation is a (file, old, new) edit on a scratch copy of the repository. A mutation that
does not apply is itself a failure (the canary went stale), never a silent pass.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
JS = "desktop/plugin.js"
API = "dashboard/plugin_api.py"
CI = ".github/workflows/ci.yml"

MUTATIONS = [
    # which replies
    ("a subagent mirror (no status) is checked", JS, "p.status === 'complete' && ", ""),
    ("a reused reply is checked again", JS, " && !p.response_reused", ""),
    ("the floor drops to 2999 in the desktop half", JS, "p.text.length >= MIN_CHARS", "p.text.length >= MIN_CHARS - 1"),
    ("a chat never opened here is checked", JS, "if (!sid || !seen.has(sid) || !eligible(payload)) return", "if (!sid || !eligible(payload)) return"),
    ("the same reply is checked twice", JS, "    if (checked.has(key)) return\n", ""),
    ("the reply key covers only the head", JS, "for (let i = 0; i < text.length; i++)", "for (let i = 0; i < Math.min(text.length, 1000); i++)"),
    ("the focus pair is read before both atoms settle", JS, "    queueMicrotask(() => {\n      pending = false\n      capture()\n    })",
     "    pending = false\n    capture()"),
    # the notice
    ("the notice is an info toast that times out", JS, "    kind: 'warning',", "    kind: 'info',"),
    ("an empty answer still shows a notice", JS, "  if (!points.length) return null\n", ""),
    ("'Open chat' is offered for the focused chat", JS, "Boolean(storedId) && storedId !== focusedStoredId", "Boolean(storedId)"),
    ("'Open chat' opens the focused chat", JS, "onClick: () => open(storedId)", "onClick: () => open(focusedStoredId)"),
    ("a failed check is swallowed", JS, "      hostApi.notify({ id: `${ID}-error`", "      void ({ id: `${ID}-error`"),
    ("the pet speaks with no pet on screen", JS, "if (ctx.pet?.visible?.get?.()) ctx.pet.say", "ctx.pet.say"),
    ("an unpriced check reads $0.00", JS, "if ((status !== 'estimated' && status !== 'actual') ||", "if ((status === 'nope') ||"),
    ("an unknown kind shows its raw key", JS, "(en.ysk.kind[p.kind] ? t('ysk.point', en.ysk.kind[p.kind], p.text) : p.text)",
     "t('ysk.point', t(`ysk.kind.${p.kind}`), p.text)"),
    ("dispose leaves the focus listeners", JS, "ctx.onDispose(() => unlisten.forEach(fn => fn?.()))", "ctx.onDispose(() => {})"),
    # the request
    ("the desktop sends the focused chat's stored id", JS, "session_id: seen.get(sid) || null",
     "session_id: hostApi.state.focusedStoredSessionId.get() || null"),
    ("the desktop omits the receipt", JS, "turn: payload.persisted_turn || null", "turn: null"),
    # backend
    ("the backend floor drops", API, "MIN_CHARS = 3000", "MIN_CHARS = 2000"),
    ("the backend calls a cheaper model", API, 'MODEL = "claude-opus-5-5"', 'MODEL = "claude-haiku-4-5"'),
    ("usage is read in the Anthropic shape (zero tokens)", API, "usage = normalize_usage(getattr(response, \"usage\", None))",
     "usage = normalize_usage(getattr(response, \"usage\", None), provider=PROVIDER)"),
    # reading the turn
    ("the store is opened writable", API, "db = SessionDB(read_only=True)", "db = SessionDB()"),
    ("an unreadable turn reads as nothing to flag", API,
     "        raise HTTPException(status_code=409, detail=\"turn not readable\") from exc",
     "        return {\"points\": [], \"cost_usd\": None, \"cost_status\": \"unknown\", \"chars\": 0}"),
    ("reasoning is sent", API, "            body = _text(row.get(\"content\"))\n",
     "            body = _text(row.get(\"content\")) + str(row.get(\"reasoning\") or \"\")\n"),
    # redaction
    ("redaction is skipped for tool results", API, "{piece(_text(row.get('content')), MAX_TOOL_RESULT_CHARS)}",
     "{_clip(_text(row.get('content')), MAX_TOOL_RESULT_CHARS)}"),
    ("redaction is not forced", API, "redact_sensitive_text(text, force=True, redact_url_credentials=True)",
     "redact_sensitive_text(text, redact_url_credentials=True)"),
    ("a </turn> in the turn's text closes the frame early", API, "        redacted = _unframe(_redact(text))\n",
     "        redacted = _redact(text)\n"),
    # caps
    ("the per-tool-result cap is removed", API, "piece(_text(row.get('content')), MAX_TOOL_RESULT_CHARS)",
     "piece(_text(row.get('content')), 10**9)"),
    ("the total cap is removed", API, "    while omitted < len(steps) and ", "    while False and "),
    ("the newest steps are omitted instead of the oldest", API, "        return steps[omitted:]\n",
     "        return steps[:len(steps) - omitted]\n"),
    ("a long piece is cut to its head only", API, 'return f"{text[:half]}\\n\\n[... {len(text) - limit} characters cut ...]\\n\\n{text[-half:]}"',
     "return text[:limit]"),
    # answers
    ("an unknown kind is dropped and read as nothing to flag", API,
     "            raise ValueError(\"a point with an unknown kind, no author or no text\")", "            continue"),
    ("an unknown kind passes", API, "if kind not in KINDS or by not in BY or", "if by not in BY or"),
    ("a second point is accepted (the first kept)", API,
     "    if not isinstance(points, list) or len(points) > MAX_POINTS:\n        raise ValueError(\"no points list of at most one point\")\n",
     "    if not isinstance(points, list):\n        raise ValueError(\"no points list\")\n    points = points[:MAX_POINTS]\n"),
    ("an unreadable answer reads as nothing to flag", API, "        raise HTTPException(status_code=502, detail=\"model answer unreadable\") from exc",
     "        return {\"points\": [], \"cost_usd\": usd, \"cost_status\": status, \"chars\": chars}"),
    ("the error message (with secrets) reaches the screen", API, 'detail=f"model call failed ({type(exc).__name__})"', 'detail=f"model call failed ({exc})"'),
    ("the ledger keeps a point's text", API, '"kinds": [p["kind"] for p in points]', '"kinds": [p["kind"] for p in points], "texts": [p["text"] for p in points]'),
    ("a pricing failure loses the points", API, "    except Exception as exc:  # noqa: BLE001 — a missing price must not hide the points",
     "    except ZeroDivisionError as exc:  # noqa: BLE001 — a missing price must not hide the points"),
    # the prompt
    ("the prompt stops saying no point is the normal answer", API, "- Most turns have nothing to flag. Then return no point; that is the normal answer.\n", ""),
    ("the prompt loses 'Never restate what the reply already says clearly'", API,
     "- Never restate what the reply already says clearly. If the reply says it, it is not a point.\n", ""),
    ("the language rule after the turn is dropped", API, ' + "\\n\\n" + LANGUAGE_RULE}]', "}]"),
    ("a point that does not name its language is accepted", API,
     '        if not isinstance(language, str) or not language.strip():\n            raise ValueError("a point that does not name the reply\'s language")\n', ""),
    # the evaluation script
    ("the eval loads the backend before Hermes' bootstrap", "eval/compare_checkers.py",
     '    bootstrap(args.core)\n    new = load(NEW_API, "ysk_eval_new")\n', '    new = load(NEW_API, "ysk_eval_new")\n    bootstrap(args.core)\n'),
    # docs and CI
    ("the total cap changes without the notes", API, "MAX_TURN_CHARS = 32000", "MAX_TURN_CHARS = 30000"),
    ("CI runs the paid evaluation", CI, "        run: python canary_audit.py",
     "        run: python canary_audit.py && python ../eval/compare_checkers.py --help"),
]


def gates(root: Path) -> list[list[str]]:
    py = sys.executable
    return [["node", str(root / "tests" / "render_check.mjs"), str(root / JS)],
            [py, str(root / "tests" / "check_api.py"), str(root / API)],
            [py, str(root / "tests" / "audit_static.py"), "--root", str(root), "--no-installed"]]


def caught(root: Path) -> bool:
    env = {**os.environ, "PYTHONUTF8": "1", "YSK_RENDER_OUT": "canary"}
    return any(subprocess.run(g, cwd=root / "tests", env=env, capture_output=True).returncode != 0 for g in gates(root))


def main() -> int:
    misses = 0
    with tempfile.TemporaryDirectory(prefix="ysk-canary-") as tmp:
        base = Path(tmp) / "repo"
        shutil.copytree(ROOT, base, ignore=shutil.ignore_patterns(".git", "node_modules", ".out", "__pycache__"))
        if caught(base):
            print("FAIL  the unmutated copy already fails a gate — fix that first")
            return 1
        for name, rel, old, new in MUTATIONS:
            target = base / rel
            original = target.read_text(encoding="utf-8")
            if original.count(old) != 1:
                print(f"STALE {name} — the text to mutate is no longer there exactly once")
                misses += 1
                continue
            target.write_text(original.replace(old, new), encoding="utf-8")
            ok = caught(base)
            target.write_text(original, encoding="utf-8")
            print(f"{'PASS' if ok else 'MISS'}  {name}")
            misses += 0 if ok else 1
    total = len(MUTATIONS)
    print(f"\ncanary: {total - misses}/{total} caught")
    return 1 if misses else 0


if __name__ == "__main__":
    sys.exit(main())
