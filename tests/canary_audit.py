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
    # the strip
    ("a point is also a toast", JS, "    notes.set([...notes.get(), note])\n",
     "    notes.set([...notes.get(), note])\n    hostApi.notify({ id: note.id, kind: 'warning', title: note.headline, message: note.text })\n"),
    ("an empty answer still shows a note", JS, "  if (!point) return null\n", "  if (!point) return { id: 'x', headline: 'x', text: 'x' }\n"),
    ("a point without a headline is shown", JS, "  if (!filled(point.headline) || !filled(point.text)) throw new Error(t('ysk.noHeadline'))\n", ""),
    ("the newest note comes first", JS, "notes.set([...notes.get(), note])", "notes.set([note, ...notes.get()])"),
    ("a single note is numbered", JS, "const numbered = list.length > 1", "const numbered = list.length > 0"),
    ("another chat's note is expanded", JS, "const expanded = !numbered || here", "const expanded = true"),
    ("'Open' is offered for the focused chat", JS, "here ? null : jsx(Button, { onClick: open,", "jsx(Button, { onClick: open,"),
    ("'Open' opens the focused chat", JS, "const open = () => void host.openSession(note.storedId)",
     "const open = () => void host.openSession(host.state.focusedStoredSessionId.get())"),
    ("'Got it' removes every note", JS, "const dismiss = id => notes.set(notes.get().filter(n => n.id !== id))", "const dismiss = id => notes.set([])"),
    ("'Got it' leaves the note", JS, "onClick: () => watcher.dismiss(note.id), children: t('ysk.gotIt')", "onClick: () => {}, children: t('ysk.gotIt')"),
    ("an asterisk glyph in the label", JS, "    label: 'Worth knowing',", "    label: 'Worth knowing \u2731',"),
    ("a chat-widget variable replaces an app token", JS, ".ysk-label-name{color:var(--ui-accent)", ".ysk-label-name{color:var(--accent)"),
    ("a third contribution area", JS, "    ctx.register({ id: 'dot',",
     "    ctx.register({ id: 'pane', area: 'panes', render: createStrip(watcher) })\n    ctx.register({ id: 'dot',"),
    ("the stroke stays hidden under reduced motion", JS, "[data-motion=\"reduce\"] .ysk-stroke path{stroke-dashoffset:0}",
     "[data-motion=\"reduce\"] .ysk-stroke path{stroke-dashoffset:400}"),
    ("'Got it' is recorded as 'Already knew'", JS, "onClick: () => watcher.dismiss(note.id), children: t('ysk.gotIt')",
     "onClick: () => void watcher.knew(note), children: t('ysk.gotIt')"),
    ("'Already knew' records nothing", JS, "      await ctx.rest('/feedback', { method: 'POST', body: { check_at: note.checkAt } })\n", ""),
    ("'Already knew' sends the headline", JS, "body: { check_at: note.checkAt }", "body: { check_at: note.checkAt, headline: note.headline }"),
    ("a failed 'Already knew' is swallowed", JS, "      hostApi.notify({ id: `${ID}-feedback-error`", "      void ({ id: `${ID}-feedback-error`"),
    ("a chat without a title shows nothing in its place", JS, "filled(note.title) ? note.title : t('ysk.untitled')", "note.title"),
    ("the dot shows on every row", JS, "if (!sessionId || !list.some(n => n.storedId === sessionId)) return null", "if (!list.length) return null"),
    ("reduced motion still staggers", JS, "style: motion === 'full' ? { animationDelay", "style: true ? { animationDelay"),
    ("the stroke draws under reduced motion", JS, "[data-motion=\"full\"] .ysk-stroke path{", ".ysk-stroke path{"),
    ("a hard-coded colour replaces a theme token", JS, "color:var(--ui-text-secondary)", "color:#6b6b6b"),
    ("a theme token the app does not declare", JS, "color:var(--ui-text-tertiary)}", "color:var(--ui-text-quinary)}"),
    ("an asterisk reaches the screen", JS, "    gotIt: 'Got it',", "    gotIt: 'Got it *',"),
    ("the strip is a pane", JS, "area: COMPOSER_AREAS.top", "area: 'panes'"),
    ("a failed check is swallowed", JS, "      hostApi.notify({ id: `${ID}-error`", "      void ({ id: `${ID}-error`"),
    ("the pet speaks with no pet on screen", JS, "if (ctx.pet?.visible?.get?.()) ctx.pet.say", "ctx.pet.say"),
    ("an unpriced check reads $0.00", JS, "if ((status !== 'estimated' && status !== 'actual') ||", "if ((status === 'nope') ||"),
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
    ("the store is opened writable", API, "        db = SessionDB(read_only=True)\n    except Exception as exc:  # noqa: BLE001 — a store that cannot open is an unreadable turn",
     "        db = SessionDB()\n    except Exception as exc:  # noqa: BLE001 — a store that cannot open is an unreadable turn"),
    ("the title store is opened writable", API, "        db = SessionDB(read_only=True)\n    except Exception as exc:  # noqa: BLE001 — a title is a nicety",
     "        db = SessionDB()\n    except Exception as exc:  # noqa: BLE001 — a title is a nicety"),
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
    ("a point without a headline is accepted", API,
     '        if not isinstance(headline, str) or not headline.strip():\n            raise ValueError("a point without a headline")\n', ""),
    ("the headline is not capped", API, "headline if len(headline) <= MAX_HEADLINE_CHARS else", "headline if True else"),
    ("the ledger keeps the headline", API, '"kinds": [p["kind"] for p in points]', '"kinds": [p["kind"] for p in points], "headlines": [p["headline"] for p in points]'),
    ("the title is read with nothing to flag", API, "title = read_title(session_id) if points else None", "title = read_title(session_id)"),
    ("an unreadable title loses the point", API, "        return None\n    finally:\n        db.close()\n    return title.strip() if isinstance(title, str) and title.strip() else None",
     "        raise\n    finally:\n        db.close()\n    return title.strip() if isinstance(title, str) and title.strip() else None"),
    ("the ledger keeps the chat's title", API, '"feedback": "already_knew", "check_at": check_at}', '"feedback": "already_knew", "check_at": check_at, "title": "TITLE-MARKER"}'),
    ("feedback accepts any check_at", API, "        raise HTTPException(status_code=400, detail=\"check_at must be a positive number\")\n", ""),
    ("the prompt no longer asks for a headline", API, '"headline": "<the point as a headline, in that language>", ', ""),
    ("the prompt loses the headline rule", API, "short newspaper headline: at most 60 characters, no final full stop", "short headline"),
    ("the response loses at", API, '"chars": chars, "at": at, "title": title}', '"chars": chars, "title": title}'),
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
    # The copy leaves node_modules behind; React and jsdom come from this checkout's tests/.
    env = {**os.environ, "PYTHONUTF8": "1", "YSK_RENDER_OUT": "canary", "YSK_NODE_MODULES": str(HERE / "node_modules")}
    return any(subprocess.run(g, cwd=root / "tests", env=env, capture_output=True).returncode != 0 for g in gates(root))


def main() -> int:
    if not (HERE / "node_modules" / "react" / "package.json").is_file() or not (HERE / "node_modules" / "jsdom" / "package.json").is_file():
        print("FAIL  tests/node_modules has no React or jsdom — run `npm ci` in tests/ first")
        return 1
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
