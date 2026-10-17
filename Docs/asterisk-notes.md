# Asterisk — design notes

## What it is for

Long replies hide the one thing that matters, and the reply is not the whole story: the assistant
made choices along the way — in its tool calls and in what their results showed — that the reply may
not mention. Asterisk rereads the whole turn and names, at most, the one thing the user
should know but would miss from the reply alone, and who decided it. It was first built as You
Should Know, after the "You Should Know" mod from the Claude Code mods video (2026-10), rebuilt on
Hermes' own extension points.

## How it works

1. The desktop half listens to `message.complete`. A frame is checked when it has status `complete`,
   is not `response_reused`, its text is at least **3,000** characters, and its runtime session is a
   chat the user has opened in this app (a subagent's mirrored frame carries no status and is never
   checked; background chats never opened here are not checked). Each reply is checked once.
2. It posts `{session_id, turn}` to the plugin's own backend, `POST /api/plugins/asterisk/check`:
   the stored id of the reply's OWN chat (not necessarily the focused one) and the frame's
   `persisted_turn` receipt — the committed row ids of the turn, from the user's message through the
   final reply (Hermes core v0.21.6 and later). It never sends the reply's text. A missing id or
   receipt is still sent; the backend refuses it and the refusal is the one error notice.
3. The backend validates the ids (400 when missing or malformed), then reads exactly those rows,
   read-only, from the store of the profile the request is scoped to, through the core's own chain:
   `SessionDB(read_only=True)` → `resolve_session_id` → `resolve_resume_session_id` →
   `get_messages(latest=True, limit=500, include_ancestors=True)`, kept to the receipt's ids. If any
   row is missing, the first is not the user's message or the last is not the final reply, the turn
   is not readable: a 409, no model call, never "nothing to flag".
4. Every piece — the user's message, the assistant's intermediate text, each tool call's arguments,
   each tool result, the final reply — goes through Hermes' redactor (`redact_sensitive_text`,
   `force=True`, `redact_url_credentials=True`) before it is cut. No redactor, no call (500).
   Then every `<turn>` or `</turn>` inside a piece (any case, spaces allowed) becomes `[turn]` or
   `[/turn]`, so a web page or file in a tool result cannot close the prompt's `<turn>` frame early.
   Reasoning is never sent.
5. Caps, in characters (a cut piece keeps its head and its tail, with a marked cut): user message
   4,000; each intermediate step 2,000; tool call arguments 600; each tool result **2,000**; final
   reply 16,000. The whole turn is at most **32,000**: over that, whole steps are dropped oldest
   first and one line says how many; the user's message and the final reply are never dropped.
6. The backend asks `claude-opus-5-5` on the `anthropic` provider through Hermes' auxiliary client
   (`call_llm`, task `asterisk`, 700 output tokens, 90 s). The answer is strict JSON: no point,
   or one point with a kind (`tradeoff`, `result`, `assumption`, `irreversible`, `security`, `cost`),
   `by` (`assistant` or `user`), the language of the final reply, a `headline` (the point as a short
   newspaper headline: at most 60 characters asked, at most 80 kept, cut with `…`) and one sentence,
   both in that language. The prompt and most tool results are English, so the user message ends,
   after the turn, with the rule to write the headline and the point in the final reply's language.
   Two points, an unknown kind, a missing `by`, a missing language or a missing headline is an error,
   never trimmed and never read as "nothing to flag". With a point the backend also reads the chat's
   title (read-only, `get_session_title`; null when it cannot be read, never an error) and returns it
   with the check's `at`.
7. One point becomes one note in the "Worth knowing" strip at the top of the composer
   (`composer.top`). A single note shows its headline (serif, underlined by a stroke in the theme's
   accent), its sentence, the cost and who decided, and "Already knew" / "Got it" (plus "Open" when
   it belongs to another chat). Several notes are a numbered list in arrival order: the focused
   chat's note is expanded, every other one is one line with its chat's title ("Untitled chat"
   without one), the cost and "Open", which opens that chat and keeps the note. A note stays until
   "Already knew" or "Got it" removes it; only "Already knew" is recorded (`POST /feedback`). The
   sidebar row of a chat with a pending note carries a dot in the accent (`sessionRow.trailing`).
   Notes live in memory only and are gone after a restart. Colours come from the app's theme tokens
   only, so the strip follows the theme in light and dark; under reduced motion the stroke is shown
   drawn and nothing animates. No point, no note. A failed check is still one error toast.

## Cost

A **measurement**, on 14 real turns from 6 sessions of one user (2026-10-17,
`eval/compare_checkers.py`; dollars estimated by Hermes' price table for Opus 5.5: $4 per million
input tokens, $20 per million output): mean about **$0.05** a check, range about $0.02–0.08 (input
4,000–16,000 tokens, mean about 10,200). 1.0.0 cost about $0.019 on the same turns. At ~15 checks a
day that is about $0.75/day, $22/month (1.0.0: about $8/month). One user's 14 turns are a small
sample; the ledger has the real figure over time.

Input is about 80% of the cost: the turn itself, capped at 32,000 characters. The rest is
output, 8–782 tokens a check (mean about 470) even when the answer is `{"points": []}`. Those tokens
are the model's thinking, not the answer (the JSON is a few dozen tokens): `claude-opus-5-5` thinks
adaptively and the core lists it as a model whose thinking cannot be switched off
(`agent/anthropic_adapter.py`, `_MANDATORY_THINKING_CLAUDE_SUBSTRINGS`); the one 8-token check is a
check where it did not think. Thinking stays on: the measured points came with it.

Usage is read in the chat-completions shape, because that is what the auxiliary client returns.
Naming the provider when reading it would read the Anthropic shape and count zero tokens.

## The ledger

`<HERMES_HOME>/state/asterisk/ledger.jsonl`, one line per check: time, final reply length,
model, input/output tokens, cost and its status, seconds, `points` (0 or 1), `kinds`, `by` (null,
`assistant` or `user`), `turn_chars`, `tool_results`, `truncated`, and `turn_complete` (the receipt's
own flag). Never any text: not the turn, not the reply, not the point, its headline or the chat's
title. A failed call writes no line; an unreadable answer writes one with `"points": null, "error":
"unreadable"`; a turn that could not be read writes `{at, model, "error": "turn_unreadable"}`. Each
"Already knew" writes `{at, "feedback": "already_knew", check_at}`, where `check_at` is the `at` of
the check it answers. Lines written by 1.0.0 stay as they are.

**Review after week two:** how many checks, the total cost, the share of checks with a point
(expected to be a minority — most turns have nothing to flag), how many were `unreadable` or
`turn_unreadable`, how many points got "Already knew" (`already_knew` lines against checks with a
point), and whether the points were worth reading. For a side-by-side judgement, label an
offline evaluation run (README → "Offline evaluation"): tick "useful" or "noise" per point. If the
points are mostly noise, turn the plugin off — it is opt-in value, not a safety layer.

## What it does not do

- It does not block, delay or rewrite the reply. It only adds a note above the input after.
- It names the assistant's unstated choices (and the user's own, when the user asked for them); it
  does not grade the assistant or add advice of its own.
- It reads the last turn only, never earlier turns, and no file beyond what the turn's tool results
  already contain. It does not read reasoning.
- It is not a safety layer: a missed point is possible. The assistant's own rules (warnings first)
  stay the first line.

## Known limits

- A chat whose id context compression rotated may show no sidebar dot (the SDK has no way to match
  the new id to its row); the strip still shows the note.
- Every composer (split view) shows the same pending list: `composer.top` does not say which chat a
  composer belongs to, so expansion follows the focused chat.
- The 2.x package test and the update-notice flag are per profile home: a 2.x package left in
  another profile is not seen, and each profile shows the notice once.
- On a core that lacks the desktop seams and has no reachable backend, no notice can be shown or
  remembered: the plugin simply registers nothing.

## Install, update, upgrade

Hermes names an installed plugin's folder after `plugin.yaml`'s `name` (`asterisk`), mounts its
backend at `/api/plugins/<manifest.json name>` (only when that name is in `plugins.enabled`), and
the desktop half's `ctx.rest` calls `/api/plugins/<plugin.js id>`; all three are `asterisk`. The
desktop half is a copy of `plugins/asterisk/desktop/` the app keeps in `desktop-plugins/asterisk`.
Install and update run in the app (Capabilities → Plugins → Install from Git; the row's Update
button), see the README.

Upgrading from 2.x (You Should Know): uninstall the `you-should-know` row, then install Asterisk.
The uninstall removes 2.x's folder, its pin and its desktop half; the old Update button would pull
3.0.0 into the old folder name, where Asterisk stays off. On its first ledger line Asterisk copies
`state/you-should-know/ledger.jsonl` to `state/asterisk/ledger.jsonl` once, byte for byte (only
while the new ledger does not exist and the 2.x package is gone). The old folder, its ledger and its
`eval/` files are never changed, moved or read beyond that one copy.

While the 2.x package is still installed in the same profile (its `plugins/you-should-know/plugin.yaml`
exists), Asterisk stands down: `/check` answers 409 before reading anything, and the desktop half,
told so by `/status`, stops checking and shows one notice per app start. Two packages would
otherwise check every long reply twice and pay twice.

## Old Hermes

Asterisk needs Hermes v0.21.6 or later, decided by seams, not by a version string. The desktop half
imports the SDK as a namespace (an old SDK lacks names, and a named import of a missing one would fail
the whole module) and checks `COMPOSER_AREAS.top`, `SESSION_ROW_AREAS.trailing`, `atom`, `useValue`,
`usePluginI18n` and `host` (`state.focusedSessionId`, `state.focusedStoredSessionId`, `notify`,
`openSession`). When one is missing it registers nothing. Otherwise it registers and asks
`POST /status`, and the backend checks the core's receipt (`PersistedTurn` in
`tui_gateway.contracts.events`). When either is too old there is one "update Hermes" notice, once
per profile: the backend creates the empty flag file `state/asterisk/update-hermes-notice` (it holds
no text and is never removed) and asks for the notice only on the call that created it. A failed
`/status` changes nothing.

## Turning it off

Capabilities → Plugins → Asterisk → off (or Uninstall). The backend route then sees no calls.
