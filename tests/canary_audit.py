"""Asterisk — canary: break the plugin on purpose, one way at a time, and require a gate to fail.

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
MANIFEST = "dashboard/manifest.json"
INIT = "__init__.py"

MUTATIONS = [
    # which replies
    ("a subagent mirror (no status) is checked", JS, "p.status === 'complete' && ", ""),
    ("a reused reply is checked again", JS, " && !p.response_reused", ""),
    ("the desktop half filters on length again", JS, "&& typeof p.text === 'string'\n",
     "&& typeof p.text === 'string' && p.text.length >= 3000\n"),
    ("the dedupe key drops the final row id", JS,
     "const key = typeof finalId === 'number' ? `${replyKey(payload.text)}:${finalId}` : replyKey(payload.text)",
     "const key = replyKey(payload.text)"),
    ("a skip answer is shown as an error", JS, "  if (!point) return null\n",
     "  if (result?.skipped) throw new Error(result.skipped)\n  if (!point) return null\n"),
    ("a chat never opened here is checked", JS, "if (!sid || !seen.has(sid) || !eligible(payload)) return", "if (!sid || !eligible(payload)) return"),
    ("the same reply is checked twice", JS, "    if (checked.has(key)) return\n", ""),
    ("the reply key covers only the head", JS, "for (let i = 0; i < text.length; i++)", "for (let i = 0; i < Math.min(text.length, 1000); i++)"),
    ("the focus pair is read before both atoms settle", JS, "    queueMicrotask(() => {\n      pending = false\n      capture()\n    })",
     "    pending = false\n    capture()"),
    # the strip
    ("a point is also a toast", JS, "    notes.set([...notes.get(), note])\n",
     "    notes.set([...notes.get(), note])\n    hostApi.notify({ id: note.id, kind: 'warning', title: note.headline, message: note.text })\n"),
    ("an empty answer still shows a note", JS, "  if (!point) return null\n", "  if (!point) return { id: 'x', headline: 'x', text: 'x' }\n"),
    ("a point without a headline is shown", JS, "  if (!filled(point.headline) || !filled(point.text)) throw new Error(t('asterisk.noHeadline'))\n", ""),
    ("the newest note comes first", JS, "notes.set([...notes.get(), note])", "notes.set([note, ...notes.get()])"),
    ("a single note is numbered", JS, "const numbered = list.length > 1", "const numbered = list.length > 0"),
    ("another chat's note is expanded", JS, "const expanded = !numbered || here", "const expanded = true"),
    ("'Open' is offered for the focused chat", JS, "            here\n              ? jsx(Button, { onClick: () => void watcher.ask(note)",
     "            false\n              ? jsx(Button, { onClick: () => void watcher.ask(note)"),
    ("'Open' opens the focused chat", JS, "const open = () => void host.openSession(note.storedId)",
     "const open = () => void host.openSession(host.state.focusedStoredSessionId.get())"),
    ("'Got it' removes every note", JS, "const dismiss = id => notes.set(notes.get().filter(n => n.id !== id))", "const dismiss = id => notes.set([])"),
    ("'Got it' leaves the note", JS, "onClick: () => void watcher.gotIt(note), children: t('asterisk.gotIt')", "onClick: () => {}, children: t('asterisk.gotIt')"),
    ("an asterisk glyph in the label", JS, "    label: 'Worth knowing',", "    label: 'Worth knowing \u2731',"),
    ("a chat-widget variable replaces an app token", JS, ".asterisk-label-name{color:var(--ui-accent)", ".asterisk-label-name{color:var(--accent)"),
    ("a third contribution area", JS, "    ctx.register({ id: 'dot',",
     "    ctx.register({ id: 'pane', area: 'panes', render: createStrip(watcher) })\n    ctx.register({ id: 'dot',"),
    ("the stroke stays hidden under reduced motion", JS, "[data-motion=\"reduce\"] .asterisk-stroke path{stroke-dashoffset:0}",
     "[data-motion=\"reduce\"] .asterisk-stroke path{stroke-dashoffset:400}"),
    ("'Got it' is recorded as 'Already knew'", JS, "const gotIt = note => leave(note, 'read',",
     "const gotIt = note => leave(note, 'already_knew',"),
    ("'Already knew' records nothing", JS, "      await ctx.rest('/dismiss', { method: 'POST', body: { check_at: note.checkAt, signal } })\n", ""),
    ("'Already knew' sends the headline", JS, "body: { check_at: note.checkAt, signal }", "body: { check_at: note.checkAt, signal, headline: note.headline }"),
    ("a failed 'Already knew' is swallowed", JS, "      hostApi.notify({ id: `${ID}-feedback-error`", "      void ({ id: `${ID}-feedback-error`"),
    ("a chat without a title shows nothing in its place", JS, "filled(note.title) ? note.title : t('asterisk.untitled')", "note.title"),
    ("the dot shows on every row", JS, "if (!sessionId || !list.some(n => n.storedId === sessionId)) return null", "if (!list.length) return null"),
    ("reduced motion still staggers", JS, "style: motion === 'full' ? { animationDelay", "style: true ? { animationDelay"),
    ("the stroke draws under reduced motion", JS, "[data-motion=\"full\"] .asterisk-stroke path{", ".asterisk-stroke path{"),
    ("a hard-coded colour replaces a theme token", JS, "color:var(--ui-text-secondary)", "color:#6b6b6b"),
    ("a theme token the app does not declare", JS, ".asterisk-label-count{color:var(--ui-text-tertiary)}", ".asterisk-label-count{color:var(--ui-text-quinary)}"),
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
    ("the backend names a model again", API, "call_llm(task=PLUGIN_ID, messages=messages,",
     'call_llm(task=PLUGIN_ID, provider="anthropic", model="claude-opus-5-5", messages=messages,'),
    ("no model chosen falls back to the main model", API,
     '    if chosen is None:\n        raise HTTPException(status_code=409, detail="no model chosen")\n', ""),
    ("the auxiliary task is not registered", INIT,
     '    ctx.register_auxiliary_task("asterisk", display_name="Asterisk", description=DESCRIPTION)\n', "    pass\n"),
    ("the task registers a default model", INIT, "description=DESCRIPTION)",
     'description=DESCRIPTION, defaults={"provider": "anthropic", "model": "claude-opus-5-5"})'),
    ("the cost is priced for the configured model, not the one that answered", API,
     'estimate_usage_cost(route.get("model"), usage, provider=route.get("provider"))',
     'estimate_usage_cost((_chosen_route() or {}).get("model"), usage, provider=(_chosen_route() or {}).get("provider"))'),
    ("the ledger names the configured model, not the one that answered", API,
     '"provider": route.get("provider"), "model": model,', '"provider": chosen["provider"], "model": chosen["model"],'),
    ("a failed model lookup blocks the check", API, '        return {"provider": None, "model": None}\n', "        return None\n"),
    ("the no-model refusal is the generic error toast", JS, "      if (detail.includes('no model chosen')) {", "      if (false) {"),
    ("the no-model notice repeats on every reply", JS, "        if (!noModelShown) {", "        if (true) {"),
    ("the no-model refusal stops later checks", JS, "          noModelShown = true\n", "          noModelShown = true\n          off = true\n"),
    ("the strip says Opus again", JS, "meta: (cost, by, title, model) => [title, model, cost, by]",
     "meta: (cost, by, title, model) => [title, 'Opus', cost, by]"),
    ("usage is read in the Anthropic shape (zero tokens)", API, "usage = normalize_usage(getattr(response, \"usage\", None))",
     "usage = normalize_usage(getattr(response, \"usage\", None), provider=route.get(\"provider\"))"),
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
    ("the ledger keeps the chat's title", API, '"feedback": signal, "check_at": check_at}', '"feedback": signal, "check_at": check_at, "title": "TITLE-MARKER"}'),
    ("feedback accepts any check_at", API, "        raise HTTPException(status_code=400, detail=\"check_at must be a positive number\")\n", ""),
    ("the prompt no longer asks for a headline", API, '"headline": "<the point as a headline, in that language>", ', ""),
    ("the prompt loses the headline rule", API, "short newspaper headline: at most 60 characters, no final full stop", "short headline"),
    ("the response loses at", API, '"chars": chars, "at": at, "title": title,', '"chars": chars, "title": title,'),
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
     '    bootstrap(args.core)\n    new = load(NEW_API, "asterisk_eval_new")\n', '    new = load(NEW_API, "asterisk_eval_new")\n    bootstrap(args.core)\n'),
    # docs and CI
    ("the total cap changes without the notes", API, "MAX_TURN_CHARS = 32000", "MAX_TURN_CHARS = 30000"),
    ("CI runs the paid evaluation", CI, "        run: python canary_audit.py",
     "        run: python canary_audit.py && python ../eval/compare_checkers.py --help"),
    # the upgrade from 2.x
    ("the old-install guard in check() is removed", API,
     '    if _old_install():\n        raise HTTPException(status_code=409, detail=f"old {OLD_ID} plugin still installed")\n', ""),
    ("the guard tests the 2.x folder instead of its plugin.yaml", API, '(_home() / "plugins" / OLD_ID / "plugin.yaml").is_file()',
     '(_home() / "plugins" / OLD_ID).is_dir()'),
    ("the 2.x ledger is not copied", API, "            _carry_over(path)\n", ""),
    ("the 2.x ledger is copied again when the new ledger exists", API, "if path.exists() or not old.is_file() or _old_install():",
     "if not old.is_file() or _old_install():"),
    ("the 2.x ledger is copied while the 2.x package is present", API, "if path.exists() or not old.is_file() or _old_install():",
     "if path.exists() or not old.is_file():"),
    # status and old cores
    ("ready ignores the core's receipt seam", API, "ready = desktop_ready is True and _core_ready()", "ready = desktop_ready is True"),
    ("the update flag is not created exclusively (the notice repeats)", API, 'with open(flag, "x", encoding="utf-8"):',
     'with open(flag, "w", encoding="utf-8"):'),
    ("/status asks for the update notice while ready", API, '"update_notice": not ready and _first_notice()', '"update_notice": _first_notice()'),
    ("plugin.js goes back to named SDK imports", JS, "import * as sdk from '@hermes/plugin-sdk'\n",
     "import * as sdk from '@hermes/plugin-sdk'\nimport { atom as a0, COMPOSER_AREAS as a1, host as a2, SESSION_ROW_AREAS as a3, "
     "usePluginI18n as a4, useValue as a5 } from '@hermes/plugin-sdk'\n"),
    ("the desktop seam check is removed (an old SDK registers anyway)", JS, "    if (!desktopReady()) {\n", "    if (false) {\n"),
    ("ready: false leaves the watcher on", JS, "off = !answer.ready || answer.old_install", "off = answer.old_install"),
    ("old_install: true leaves the watcher on", JS, "off = !answer.ready || answer.old_install", "off = !answer.ready"),
    ("the update notice shows without update_notice: true", JS, "answer?.update_notice === true && ", ""),
    # the name
    ("manifest.json's name goes back to the 2.x name", MANIFEST, '"name": "asterisk"', '"name": "you-should-know"'),
    ("the auxiliary task goes back to the 2.x name", API, "call_llm(task=PLUGIN_ID,", 'call_llm(task="you_should_know",'),
    # check scope (4.1.0): skips, trigger, earlier messages, kinds
    ("a missing receipt is a 400 again", API, '    if turn is None:\n        return False\n', '    if turn is None:\n        return True\n'),
    ("a missing user row id is a 400", API, '    if turn.get("user_row_id") is None:\n        return "no_user_row"\n', ""),
    ("a skip is not recorded", API, '    _record({"at": at, "skipped": reason})\n', ""),
    ("a skip reads as an error", API, '    return {"points": [], "skipped": reason}\n',
     '    raise HTTPException(status_code=409, detail="turn not readable")\n'),
    ("a missing row is a 409 again", API, '        raise TurnSkipped("rows_missing")\n',
     '        raise TurnUnreadable("rows missing")\n'),
    ("no model chosen is a skip when the receipt is missing", API,
     "    chosen = _chosen_route()\n    if chosen is None:\n        raise HTTPException(status_code=409, detail=\"no model chosen\")\n    at = round(now if now is not None else time.time(), 3)\n    reason = _receipt_skip(turn)\n    if reason:\n        return _skip(at, reason)\n",
     "    at = round(now if now is not None else time.time(), 3)\n    reason = _receipt_skip(turn)\n    if reason:\n        return _skip(at, reason)\n    chosen = _chosen_route()\n    if chosen is None:\n        raise HTTPException(status_code=409, detail=\"no model chosen\")\n"),
    ("a turn without the trigger is checked", API, "    if not needs_check(rows):\n", "    if False:\n"),
    ("the trigger ignores tool calls", API, "            if _may_change(name if isinstance(name, str) else \"\"):\n", "            if False:\n"),
    ("the classifier failure skips the turn", API,
     "        log.warning(\"asterisk: tool classification unavailable (%s)\", type(exc).__name__)\n        return True\n",
     "        log.warning(\"asterisk: tool classification unavailable (%s)\", type(exc).__name__)\n        return False\n"),
    ("the length trigger moves to 3001", API, "    if len(_text(rows[-1].get(\"content\"))) >= MIN_CHARS:\n",
     "    if len(_text(rows[-1].get(\"content\"))) > MIN_CHARS:\n"),
    ("the user-view check is dropped (a summary row reads as the user's)", API,
     "    if view is None:\n        raise TurnSkipped(\"not_user_turn\")\n", "    view = view or kept[0]\n"),
    ("a missing user view stops the check", API,
     "    except UserViewUnavailable:\n        view, views = (kept[0] if kept[0].get(\"role\") == \"user\" else None), []\n",
     "    except UserViewUnavailable:\n        raise TurnUnreadable(\"no user view\")\n"),
    ("earlier rows are read without the core's view", API, "    texts = [_text(v.get(\"content\")) for v in views if v is not None]\n",
     "    texts = [_text(r.get(\"content\")) for r in before]\n"),
    ("earlier messages are not capped in count", API, "    earlier = [t for t in texts if t.strip()][-MAX_EARLIER_MESSAGES:]\n",
     "    earlier = [t for t in texts if t.strip()]\n"),
    ("the oldest earlier messages are kept instead of the newest", API,
     "    earlier = [t for t in texts if t.strip()][-MAX_EARLIER_MESSAGES:]\n",
     "    earlier = [t for t in texts if t.strip()][:MAX_EARLIER_MESSAGES]\n"),
    ("an earlier message is not redacted", API, "_clip(_unframe(_redact(message)), MAX_EARLIER_MESSAGE_CHARS)",
     "_clip(_unframe(message), MAX_EARLIER_MESSAGE_CHARS)"),
    ("an earlier message is not unframed", API, "_clip(_unframe(_redact(message)), MAX_EARLIER_MESSAGE_CHARS)",
     "_clip(_redact(message), MAX_EARLIER_MESSAGE_CHARS)"),
    ("an earlier message is not cut", API, "_clip(_unframe(_redact(message)), MAX_EARLIER_MESSAGE_CHARS)",
     "_clip(_unframe(_redact(message)), 10**9)"),
    ("the earlier block is not capped", API, "    while pieces and len(render(pieces)) > MAX_EARLIER_CHARS:\n",
     "    while False:\n"),
    ("the newest earlier message is dropped first", API, "        pieces = pieces[1:]\n", "        pieces = pieces[:-1]\n"),
    ("the earlier block is never sent", API, "        response = _call_llm(build_messages(turn_text, earlier_text), route)\n",
     "        response = _call_llm(build_messages(turn_text), route)\n"),
    ("an <earlier> tag inside a message is not unframed", API, "(turn|earlier)\\b", "(turn)\\b"),
    ("the ledger loses earlier_chars", API, ',\n             "earlier_chars": len(earlier_text)}', "}"),
    ("the ledger keeps the earlier text", API, '"earlier_chars": len(earlier_text)}', '"earlier_chars": len(earlier_text), "earlier": earlier_text}'),
    ("the new kinds are dropped", API, ', "unanswered", "overclaim", "constraint",\n         "overreach")', ")"),
    ("the prompt drops the earlier-is-context rule", API, "- The earlier messages are context only: use them to see what the user asked for or ruled out before\n", "- \n"),
    ("no_final_row becomes the 4.0.0 error again", API, '    if turn.get("final_assistant_row_id") is None:\n        return "no_final_row"\n', ""),
    ("turn_too_long becomes the 4.0.0 error again", API, '    if len(turn["row_ids"]) > MAX_TURN_ROWS:\n        return "turn_too_long"\n',
     '    if len(turn["row_ids"]) > MAX_TURN_ROWS:\n        raise HTTPException(status_code=400, detail="turn ids missing or malformed")\n'),
    ("not_user_turn becomes the 4.0.0 error again", API, '        raise TurnSkipped("not_user_turn")\n',
     '        raise TurnUnreadable("the turn does not start with a user message")\n'),
    ("no_trigger becomes the 4.0.0 error again", API, '        return _skip(at, "no_trigger")\n',
     '        raise HTTPException(status_code=400, detail="reply shorter than 3000 characters")\n'),
    ("a skip calls the model", API, '        return _skip(at, "no_trigger")\n',
     '        _call_llm(build_messages("x"), {})\n        return _skip(at, "no_trigger")\n'),
    ("a skip line carries a text field", API, '    _record({"at": at, "skipped": reason})\n',
     '    _record({"at": at, "skipped": reason, "text": reason})\n'),
    ("a malformed receipt (a bool id) is skipped instead of refused", API,
     "    return any(turn.get(k) is not None and (not _is_id(turn.get(k)) or turn.get(k) not in ids)\n",
     "    return any(turn.get(k) is not None and not isinstance(turn.get(k), bool) and (not _is_id(turn.get(k)) or turn.get(k) not in ids)\n"),
    ("every tool counts for the trigger", API, "        return bool(tool_may_have_side_effect(name))\n", "        return True\n"),
    ("a copied read-only tool set replaces the classifier", API,
     "        from agent.tool_result_classification import tool_may_have_side_effect\n        return bool(tool_may_have_side_effect(name))\n",
     "        return name not in {\"read_file\", \"search_files\", \"web_search\", \"web_extract\"}\n"),
    ("the priority groups are reordered", API, 'PRIORITY = (("irreversible", "security"), ("unanswered", "overclaim", "constraint"), ("result", "cost"),',
     'PRIORITY = (("result", "cost"), ("unanswered", "overclaim", "constraint"), ("irreversible", "security"),'),
    ("the widened result sentence is reverted", API,
     "- result: a result the reply presents as done or correct that the turn's tool results put in doubt, or\n  a definite value the reply states from a tool result that was empty, truncated, stale, malformed or\n  failed (even when the tool reported success)\n",
     "- result: a result the reply presents as done or correct that the turn's tool results put in doubt\n"),
    ("MAX_EARLIER_CHARS changes without the notes", API, "MAX_EARLIER_CHARS = 2000", "MAX_EARLIER_CHARS = 2400"),
    ("the eval keeps the old length rule", "eval/compare_checkers.py", "new.needs_check(", "(lambda rows: len(str(rows[-1].get('content') or '')) >= 3000)("),
    # note actions (4.2.0): Ask in chat, fold, three signals, notes that survive a restart
    ("Ask in chat submits", JS, "hostApi.composer.insertText(note.storedId", "hostApi.composer.submit(note.storedId"),
    ("Ask in chat replaces the draft", JS, "hostApi.composer.insertText(note.storedId", "hostApi.composer.setDraft(note.storedId"),
    ("Ask in chat addresses the active composer", JS, "insertText(note.storedId, t('asterisk.askText'", "insertText(null, t('asterisk.askText'"),
    ("Ask in chat is offered on another chat's note", JS, "            here\n              ? jsx(Button, { onClick: () => void watcher.ask(note)",
     "            true\n              ? jsx(Button, { onClick: () => void watcher.ask(note)"),
    ("the note stays after a true insert", JS, "    await leave(note, 'asked', t('asterisk.askInChat'))\n",
     "    await ctx.rest('/dismiss', { method: 'POST', body: { check_at: note.checkAt, signal: 'asked' } })\n"),
    ("a false insert removes the note", JS, "    if (done !== true) {\n      hostApi.notify(", "    if (done !== true) {\n      dismiss(note.id)\n      hostApi.notify("),
    ("a false insert posts asked", JS, "message: t('asterisk.askFailed') })\n      return\n", "message: t('asterisk.askFailed') })\n"),
    ("the inserted text drops the headline", JS, "askText: (headline, text) => `Asterisk: ${headline} — ${text}`", "askText: (headline, text) => `Asterisk: ${text}`"),
    ("Ask in chat posts read", JS, "leave(note, 'asked',", "leave(note, 'read',"),
    ("the pending guard is removed", JS, "    if (asking.has(note.id)) return\n", ""),
    ("Got it posts nothing again", JS, "onClick: () => void watcher.gotIt(note)", "onClick: () => watcher.dismiss(note.id)"),
    ("Already knew posts read", JS, "const knew = note => leave(note, 'already_knew',", "const knew = note => leave(note, 'read',"),
    ("the chevron does not fold", JS, "onClick: watcher.toggleFold,", "onClick: () => {},"),
    ("folding empties the notes", JS, "const toggleFold = () => folded.set(!folded.get())", "const toggleFold = () => notes.set([])"),
    ("folded still renders the list", JS, "            isFolded\n              ? null\n", "            false\n              ? null\n"),
    ("a new note does not unfold", JS, "    folded.set(false)\n    if (ctx.pet", "    if (ctx.pet"),
    ("the chevron loses aria-expanded", JS, "                  'aria-expanded': isFolded ? 'false' : 'true',\n", ""),
    ("the fold transition is not keyed on data-motion full", JS, "[data-motion=\"full\"] .asterisk-fold svg{transition", ".asterisk-fold svg{transition"),
    ("desktopReady drops the composer check", JS, " && typeof h.composer?.insertText === 'function'", ""),
    ("restore is never called", JS, "void watcher.status().then(() => watcher.restore())", "void watcher.status()"),
    ("restore runs when status says off", JS, "  async function restore() {\n    if (off) return\n", "  async function restore() {\n"),
    ("a dismissed note comes back from a late /notes", JS, "if (note && !gone.has(note.checkAt)) back.push(note)", "if (note) back.push(note)"),
    ("a restored note duplicates a live one", JS, "...notes.get().filter(n => !backAt.has(n.checkAt))", "...notes.get()"),
    ("restored notes come newest first", JS, "sort((a, b) => a?.at - b?.at)", "sort((a, b) => b?.at - a?.at)"),
    ("a failed /notes is swallowed", JS, "      hostApi.notify({ id: `${ID}-restore-error`", "      void ({ id: `${ID}-restore-error`"),
    ("restored notes unfold the strip", JS, "    notes.set([...back, ...notes.get().filter(n => !backAt.has(n.checkAt))])\n",
     "    notes.set([...back, ...notes.get().filter(n => !backAt.has(n.checkAt))])\n    folded.set(false)\n"),
    ("a point is not kept", API, "        _keep_note(note)\n", ""),
    ("a dismissal leaves the stored note", API, "    _drop_note(check_at)\n", ""),
    ("the note cap is removed", API, "(entries + [entry])[-NOTES_MAX:]", "(entries + [entry])"),
    ("the notes file moves under state/asterisk/", API, "return plugin_data_dir(PLUGIN_ID) / NOTES_FILE", 'return _home() / "state" / PLUGIN_ID / NOTES_FILE'),
    ("a stored note's text reaches the ledger", API, "def _keep_note(entry: dict) -> None:\n",
     'def _keep_note(entry: dict) -> None:\n    _record({"at": entry["at"], "note": entry})\n'),
    ("a gone chat's note is restored", API, "if db.resolve_session_id(sid) is None}", "if False}"),
    ("a store that cannot open drops every note", API,
     '        log.warning("asterisk: chats not checked (%s)", type(exc).__name__)\n        return set()\n    try:\n',
     '        log.warning("asterisk: chats not checked (%s)", type(exc).__name__)\n        return {e["session_id"] for e in entries}\n    try:\n'),
    ("an unknown signal is accepted", API, "    if signal not in SIGNALS:\n", "    if False:\n"),
    ("/dismiss records already_knew for every signal", API, '"feedback": signal,', '"feedback": "already_knew",'),
    ("a storage failure loses the point", API,
     '        log.warning("asterisk: note storage unavailable (%s)", type(exc).__name__)\n        return None\n', "        raise\n"),
    ("/notes answers [] instead of 503 without storage", API,
     '        raise HTTPException(status_code=503, detail="note storage unavailable")\n', '        return {"notes": []}\n'),
    ("NOTES_MAX changes without the notes", API, "NOTES_MAX = 50", "NOTES_MAX = 40"),
]


def gates(root: Path) -> list[list[str]]:
    py = sys.executable
    return [["node", str(root / "tests" / "render_check.mjs"), str(root / JS)],
            [py, str(root / "tests" / "check_api.py"), str(root / API)],
            [py, str(root / "tests" / "audit_static.py"), "--root", str(root), "--no-installed"]]


def caught(root: Path) -> bool:
    # The copy leaves node_modules behind; React and jsdom come from this checkout's tests/.
    env = {**os.environ, "PYTHONUTF8": "1", "ASTERISK_RENDER_OUT": "canary", "ASTERISK_NODE_MODULES": str(HERE / "node_modules")}
    return any(subprocess.run(g, cwd=root / "tests", env=env, capture_output=True).returncode != 0 for g in gates(root))


def main() -> int:
    if not (HERE / "node_modules" / "react" / "package.json").is_file() or not (HERE / "node_modules" / "jsdom" / "package.json").is_file():
        print("FAIL  tests/node_modules has no React or jsdom — run `npm ci` in tests/ first")
        return 1
    misses = 0
    with tempfile.TemporaryDirectory(prefix="asterisk-canary-") as tmp:
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
