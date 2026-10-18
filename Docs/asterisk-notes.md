# Asterisk — design notes

## What it is for

Long replies hide the one thing that matters, and the reply is not the whole story: the assistant
made choices along the way — in its tool calls and in what their results showed — that the reply may
not mention, and a short "Done." after a file write can hide as much as a long reply. Asterisk
rereads the whole turn and names, at most, the one thing the user
should know but would miss from the reply alone, and who decided it. It was first built as You
Should Know, after the "You Should Know" mod from the Claude Code mods video (2026-10), rebuilt on
Hermes' own extension points.

## How it works

1. The desktop half listens to `message.complete`. A frame is posted when it has status `complete`,
   is not `response_reused`, its text is a string, and its runtime session is a chat the user has
   opened in this app (a subagent's mirrored frame carries no status and is never posted;
   background chats never opened here are not posted). Each reply is posted once: the key is the
   whole text plus the receipt's final row id, so two turns with the same short text ("Done.") are
   both posted. The desktop half has no length test; the backend alone decides.
2. It posts `{session_id, turn}` to the plugin's own backend, `POST /api/plugins/asterisk/check`:
   the stored id of the reply's OWN chat (not necessarily the focused one) and the frame's
   `persisted_turn` receipt — the committed row ids of the turn, from the user's message through the
   final reply (Hermes core v0.21.6 and later). It never sends the reply's text. A missing receipt
   is still sent (`turn: null`); the backend decides what it means.
3. The backend refuses a malformed request (400: a receipt that is not an object, row ids missing,
   empty or not positive ints, a user or final row id that is present but not one of them). It then
   skips, silently, every turn the receipt cannot prove — a normal core state, not an error — and
   every proven turn without the trigger. A skip answers `{points: [], skipped: <reason>}`, writes one
   ledger line `{at, skipped}` (no text), shows no note and no notice, and calls no model:

   | Reason | When |
   |---|---|
   | `no_receipt` | the frame had no `persisted_turn` (the core builds none after compaction moved the cursor, for a preflight transcript, or when no row of the turn is committed) |
   | `no_user_row` | the receipt has no `user_row_id` (the row at the cursor is not committed; "missing ids are unproven") |
   | `no_final_row` | the receipt has no `final_assistant_row_id` (the last row is not a committed final reply) |
   | `turn_too_long` | the receipt lists more than 500 rows (the store read is capped at 500) |
   | `rows_missing` | a receipt row is not among the live rows the store returns (in-place compaction or rewind archived it) |
   | `not_user_turn` | the first row is not the user's own message by the core's `user_originated_turn_view` (a compaction summary, a notification) |
   | `no_trigger` | the turn was proven, but the assistant used no tool that can change something and the reply is under **3,000** characters |

   The trigger: a turn is checked when its final reply is at least 3,000 characters, or when any
   assistant row of THAT turn (never an earlier one) has a tool call the core calls effect-capable
   (`agent.tool_result_classification.tool_may_have_side_effect`: true for every name outside its
   read-only list, so `terminal`, `execute_code`, MCP and plugin tools count). If the classifier
   cannot be imported or raises, the turn is checked (fail-open).
   The rows are read read-only from the store of the profile the request is scoped to, through the
   core's own chain: `SessionDB(read_only=True)` → `resolve_session_id` → `resolve_resume_session_id`
   → `get_messages(latest=True, limit=500, include_ancestors=True)`, kept to the receipt's ids. A
   receipt that contradicts the store (the store cannot open, the session is unknown, the first row
   is not the user row id, the last is not the final reply) is a 409, no model call, never "nothing
   to flag".
4. The user's earlier messages: from the rows already read, the rows before the turn that the core's
   `user_originated_turn_view` calls the user's own (a `steer` row too; never an assistant reply, a
   tool result, a compaction summary or a notification row): the last 5 user messages before the turn, each at most 500 characters, at most 2,000 together
   (the oldest dropped whole), oldest first, framed once in `<earlier>` before the turn, as context
   only. Without the core's view the
   check still runs, with no earlier messages. The turn's own `[user]` block is the view's content.
5. Every piece — the user's message, each earlier message, the assistant's intermediate text, each
   tool call's arguments, each tool result, the final reply — goes through Hermes' redactor
   (`redact_sensitive_text`, `force=True`, `redact_url_credentials=True`) before it is cut. No
   redactor, no call (500). Then every `<turn>`, `</turn>`, `<earlier>` or `</earlier>` inside a
   piece (any case, spaces allowed) becomes `[turn]`, `[/turn]`, `[earlier]` or `[/earlier]`, so a
   web page or file in a tool result cannot close the prompt's frames early. Reasoning is never sent.
   Caps, in characters (a cut piece keeps its head and its tail, with a marked cut): user message
   4,000; each intermediate step 2,000; tool call arguments 600; each tool result **2,000**; final
   reply 16,000. The whole turn is at most **32,000**: over that, whole steps are dropped oldest
   first and one line says how many; the user's message and the final reply are never dropped.
6. The backend names no model. `__init__.py` registers the auxiliary task `asterisk`, which is its
   own row in Settings → Models → Auxiliary models; the provider and model come from that row, and
   the call (`call_llm`, task `asterisk`, 700 output tokens, 90 s) passes neither. Before reading the
   turn the backend asks Hermes whether a model is chosen for the task
   (`agent.auxiliary_client._resolve_task_provider_model("asterisk")`, never `config.yaml` directly):
   "auto" with no model means nothing is chosen, and `/check` answers 409 `no model chosen` without
   opening the store, redacting, calling or recording anything; the desktop half shows one notice
   per app start saying where to choose and keeps posting, so a model chosen mid-session works on
   the next reply. It never falls back to the main model on its own: the check reviews the main
   model's own turn, and each check spends money on the chosen model, so the user picks it ("Set to
   main" on the row is the one-click way to use the main model). A lookup that raises is logged and
   the check proceeds (fail-open; a real failure is then the call's 502). `call_llm` fills a
   `route_info` dict with the provider and model that answered, a fallback included: the cost is
   priced for that route, the ledger names it and `/check` returns its `model`, which the strip
   shows. The answer is strict JSON: no point,
   or one point with a kind, `by` (`assistant` or `user`), the language of the final reply, a
   `headline` (the point as a short newspaper headline: at most 60 characters asked, at most 80
   kept, cut with `…`) and one sentence, both in that language. The ten kinds: `tradeoff`, `result`
   (also a definite value taken from an empty, truncated, stale, malformed or failed tool result),
   `assumption`, `irreversible`, `security`, `cost`, `unanswered` (asked for, neither done nor said
   skipped), `overclaim` (reported read / ran / tested but not done in the turn), `constraint`
   (something the user said not to do, in this turn or an earlier message, that was done) and
   `overreach` (done without being asked). When several apply, one is named, from the first group
   that has one: 1. irreversible, security; 2. unanswered, overclaim, constraint; 3. result, cost;
   4. tradeoff, assumption, overreach (within a group, the one that matters most to the user). The
   prompt and most tool results are English, so the user message ends,
   after the turn, with the rule to write the headline and the point in the final reply's language.
   Two points, an unknown kind, a missing `by`, a missing language or a missing headline is an error,
   never trimmed and never read as "nothing to flag". With a point the backend also reads the chat's
   title (read-only, `get_session_title`; null when it cannot be read, never an error) and returns it
   with the check's `at`.
7. One point becomes one note in the "Worth knowing" strip at the top of the composer
   (`composer.top`). A single note shows its headline (serif, underlined by a stroke in the theme's
   accent), its sentence, the cost and who decided, and "Already knew" / "Ask in chat" / "Got it"
   for the focused chat's note, or "Already knew" / "Open" / "Got it" when it belongs to another
   chat. Several notes are a numbered list in arrival order: the focused chat's note is expanded,
   every other one is one line with its chat's title ("Untitled chat" without one), the cost and
   "Open", which opens that chat and keeps the note.
   "Ask in chat" (focused chat's note only) puts the note into that chat's input through
   `host.composer.insertText`, addressed by the note's own chat id (never "whichever composer has
   focus"), in block mode: after the user's draft, separated by a blank line, so the draft is kept.
   The text is exactly `Asterisk: <headline> — <sentence>`, both in full. It never sends: no turn on
   the main model starts until the user presses send. When the insert succeeds the note leaves the
   strip; when it fails (that chat's input is not on screen) the note stays and one warning says to
   click into the input and try again. A second click while an insert is pending does nothing.
   A chevron in the strip's header folds it to one line ("Worth knowing · 3 notes", the label
   underlined by the accent stroke); the notes and the sidebar dots stay, and a new note unfolds it.
   The fold is not stored. A note stays until "Ask in chat", "Got it" or "Already knew" removes it;
   each removal posts `POST /dismiss {check_at, signal}` with the signal `asked`, `read` or
   `already_knew`. The sidebar row of a chat with a pending note carries a dot in the accent
   (`sessionRow.trailing`). Pending notes survive an app restart during the development phase (see
   "Notes on disk (development phase)"). Colours come from the app's theme tokens
   only, so the strip follows the theme in light and dark; under reduced motion the stroke is shown
   drawn and nothing animates. No point, no note. A failed check is still one error toast.

## Cost (measured on `claude-opus-5-5` only)

A **measurement**, on 14 real turns from 6 sessions of one user (2026-10-17, with `claude-opus-5-5`
on `anthropic`, the model 3.0.0 always used;
`eval/compare_checkers.py`; dollars estimated by Hermes' price table for Opus 5.5: $4 per million
input tokens, $20 per million output): mean about **$0.05** a check, range about $0.02–0.08 (input
4,000–16,000 tokens, mean about 10,200). 1.0.0 cost about $0.019 on the same turns. At ~15 checks a
day that is about $0.75/day, $22/month (1.0.0: about $8/month). One user's 14 turns are a small
sample; the ledger has the real figure over time. Other models are not measured: their cost and the
quality of their points are unknown.

Volume (4.1.0): on one user's history (30 days, 4 active days, 403 turns, counts only, no message
text read) the 4.0.0 rule checked about 14 turns per active day (~$0.74) and the new rule about 75
(~$4.0 at 5.3 cents a check). Not measured: what a short-reply check costs, what the added earlier
messages cost (at most 2,000 characters, ~800 tokens, ~$0.003 on `claude-opus-5-5`), and the
volume and noise of the four new kinds.

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
`provider` and `model` (the route that answered, a fallback included, as `call_llm` reported it;
the same model id prices differently per provider), input/output tokens, cost and its status,
seconds, `points` (0 or 1), `kinds`, `by` (null,
`assistant` or `user`), `turn_chars`, `tool_results`, `truncated`, `turn_complete` (the receipt's
own flag) and `earlier_chars` (the length of the earlier-messages block, 0 when none). Never any
text: not the turn, not an earlier message, not the reply, not the point, its headline or the
chat's title. A skipped turn writes `{at, skipped}` with its reason (a check line's `chars` under
3,000 marks a tool-triggered check). A failed call writes no line; an unreadable answer writes one with `"points": null, "error":
"unreadable"`; a turn that could not be read writes `{at, provider, model, "error":
"turn_unreadable"}` with the chosen route (no call was made); `no model chosen` still writes nothing. Each
dismissal writes `{at, "feedback": <signal>, check_at}`, where the signal is `asked` ("Ask in
chat"), `read` ("Got it") or `already_knew` ("Already knew") and `check_at` is the `at` of the check
it answers (before 4.2.0 only `already_knew` was written; "Got it" recorded nothing). Lines written
by 1.0.0 stay as they are.

**Review after week two:** how many checks, the total cost, the share of checks with a point
(expected to be a minority — most turns have nothing to flag), how many were `unreadable` or
`turn_unreadable`, how each point left (`asked`, `read` and `already_knew` lines, each counted
against checks with a point), and whether the points were worth reading. For a side-by-side judgement, label an
offline evaluation run (README → "Offline evaluation"): tick "useful" or "noise" per point. If the
points are mostly noise, turn the plugin off — it is opt-in value, not a safety layer.

## Notes on disk (development phase)

For the development phase, while the notes' usefulness is measured, pending notes survive an app
restart. The backend keeps the text of each pending note — headline, sentence, chat title, model,
cost and who decided, plus the chat's id and the check's `at` — in
`<HERMES_HOME>/plugin-data/asterisk/notes.json` (the host's plugin storage,
`plugins.plugin_storage.plugin_data_dir`, so it follows the active profile), apart from the ledger,
which still holds no text. It keeps at most 50 notes; past that the oldest is dropped. "Ask in
chat", "Got it" and "Already knew" each remove the note from the file (`POST /dismiss`). At each app
start the desktop half asks for the pending notes (`POST /notes`, after `/status`, only when
Asterisk is on); a note whose chat no longer exists in the store is dropped then. When the store
cannot be opened nothing is dropped. Restored notes do not unfold the strip or make the pet speak.

- Notes from 4.1.0 are not carried over: 4.1.0 kept them in memory only and wrote none to disk.
- A downgrade or an uninstall leaves `notes.json` on disk, unread (the core keeps `plugin-data` on
  remove). Delete `<HERMES_HOME>/plugin-data/asterisk/notes.json` by hand.
- No storage (the host module missing or failing) never loses a point: `/check` still answers and
  writes its ledger line, `/dismiss` still records, and `/notes` answers 503 (one error notice).

**How to remove this later:** in `dashboard/plugin_api.py` delete the `NOTES_*` block (`NOTES_FILE`
through `notes()`), the `/notes` route, the keep call in `check()` and the drop call in
`dismiss()`; in `desktop/plugin.js` delete `restore()`, its call in `register` and the `gone` set;
delete their locks in `tests/check_api.py` and `tests/render_check.mjs`, their lines in
`tests/canary_audit.py`, the `notes` rule in `tests/audit_static.py` and the `storage` seam in
`tests/contract_core.py`; then delete the file.

## What it does not do

- It does not block, delay or rewrite the reply. It only adds a note above the input after.
- It names the assistant's unstated choices (and the user's own, when the user asked for them); it
  does not grade the assistant or add advice of its own.
- It reads the last turn only: never the assistant's earlier replies or earlier tool results; only
  the user's own earlier messages, capped. No file beyond what the turn's tool results already
  contain. It does not read reasoning.
- It is not a safety layer: a missed point is possible. The assistant's own rules (warnings first)
  stay the first line.

## Known limits

- Whether a model is chosen is read from the core's private `_resolve_task_provider_model` rather
  than re-derived from `config.yaml` (one rule, the core's). A core that renames or reshapes it
  breaks the test; `tests/contract_core.py` seam `taskroute` locks it, and a lookup that raises is
  fail-open.
- Read-only is the core's `tool_may_have_side_effect`: a read-only terminal command, `tool_search`
  or `tool_describe` still triggers a check (cost accepted); a short reply with no tool call is
  never checked, so an overclaim in it is missed.
- Turns the receipt cannot prove (compaction during the turn, no receipt, more than 500 rows) are
  skipped, not checked.
- Two more private core imports: `agent.tool_result_classification.tool_may_have_side_effect` (the
  trigger) and `agent.context_compressor.user_originated_turn_view` (which user rows are the user's
  own). Each sits behind one helper, is fail-open (the classifier: check the turn; the view: accept
  a `user` row and send no earlier messages) and is locked by a `tests/contract_core.py` seam
  (`sideeffect`, `userview`); the skip states are locked by seam `unproven`.
- A configured fallback chain may answer on another model than the one chosen; the ledger and the
  strip then name the model that answered, and the cost is priced for it.
- A chat whose id context compression rotated may show no sidebar dot (the SDK has no way to match
  the new id to its row); the strip still shows the note.
- Every composer (split view) shows the same pending list: `composer.top` does not say which chat a
  composer belongs to, so expansion follows the focused chat.
- The 2.x package test and the update-notice flag are per profile home: a 2.x package left in
  another profile is not seen, and each profile shows the notice once.
- On a core that lacks the desktop seams and has no reachable backend, no notice can be shown or
  remembered: the plugin simply registers nothing.
- A dismissal whose `/dismiss` failed (one error notice) leaves the note in `notes.json`, so it
  comes back after a restart.
- A note pushed out by the 50-note cap is not restored.
- A restored note shows the chat's title as it was at check time.
- "Ask in chat" inserts into the note's chat only when that chat's input is on screen; otherwise it
  warns and the note stays.

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
otherwise check every reply twice and pay twice.

## Old Hermes

Asterisk needs Hermes v0.21.6 or later, decided by seams, not by a version string. The desktop half
imports the SDK as a namespace (an old SDK lacks names, and a named import of a missing one would fail
the whole module) and checks `COMPOSER_AREAS.top`, `SESSION_ROW_AREAS.trailing`, `atom`, `useValue`,
`usePluginI18n` and `host` (`state.focusedSessionId`, `state.focusedStoredSessionId`, `notify`,
`openSession`, `composer.insertText`). When one is missing it registers nothing. Otherwise it registers and asks
`POST /status`, and the backend checks the core's receipt (`PersistedTurn` in
`tui_gateway.contracts.events`). When either is too old there is one "update Hermes" notice, once
per profile: the backend creates the empty flag file `state/asterisk/update-hermes-notice` (it holds
no text and is never removed) and asks for the notice only on the call that created it. A failed
`/status` changes nothing.

## Turning it off

Capabilities → Plugins → Asterisk → off (or Uninstall). The backend route then sees no calls.
