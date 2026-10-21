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
   accent), its sentence, the cost and who decided, and "Already knew" / "Not sure" / "Not useful" /
   "Ask in chat" / "Got it" for the focused chat's note, or "Already knew" / "Not sure" / "Not useful"
   / "Open" / "Got it" when it belongs to another chat. Several notes are a numbered list in arrival order: the focused chat's note is expanded,
   every other one is one line with its chat's title ("Untitled chat" without one), the cost and
   "Open", which opens that chat and keeps the note.
   "Ask in chat" (focused chat's note only) puts the note into that chat's input through
   `host.composer.insertText`, addressed by the note's own chat id (never "whichever composer has
   focus"), in block mode: after the user's draft, separated by a blank line, so the draft is kept.
   The text is exactly `Asterisk: <headline> — <sentence>`, both in full; a Playful note puts its
   kind's label ("Left unanswered") in place of the headline, so the joke never goes into the chat
   (a note stored before 4.5.0 has no tone and keeps its headline). It never sends: no turn on
   the main model starts until the user presses send. When the insert succeeds the note leaves the
   strip; when it fails (that chat's input is not on screen) the note stays and one warning says to
   click into the input and try again. A second click while an insert is pending does nothing.
   A chevron in the strip's header folds it to one line ("Worth knowing · 3 notes", the label
   underlined by the accent stroke); the notes and the sidebar dots stay, and a new note unfolds it.
   The fold is not stored. A note stays until "Ask in chat", "Got it", "Already knew", "Not sure" or
   "Not useful" removes it, in one click; each removal posts `POST /dismiss {check_at, signal}` with
   the signal `asked`, `read`, `already_knew`, `unsure` or `not_useful`. The sidebar row of a chat with a pending note carries a dot in the accent
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
own flag), `earlier_chars` (the length of the earlier-messages block, 0 when none), `tone` and
`enabled` (the saved tone and the kinds that were on, ids only; `filtered` when a point of a kind
switched off was dropped), `prompt` (the prompt revision, 2 from 4.5.0) and `numbers` when a number
the turn does not state was taken out (`option`, `rewritten` or `failed`, see "Numbers the turn does
not state"). Never any
text: not the turn, not an earlier message, not the reply, not the point, its headline or the
chat's title. A skipped turn writes `{at, skipped}` with its reason (a check line's `chars` under
3,000 marks a tool-triggered check). A failed call writes no line; an unreadable answer writes one with `"points": null, "error":
"unreadable"`; a turn that could not be read writes `{at, provider, model, "error":
"turn_unreadable"}` with the chosen route (no call was made); `no model chosen` still writes nothing. Each
dismissal writes `{at, "feedback": <signal>, check_at}`, where `check_at` is the `at` of the check
it answers and the signal says how the note left:

| Button | Signal | Means |
|---|---|---|
| Ask in chat | `asked` | useful, taken into the chat |
| Got it | `read` | read |
| Already knew | `already_knew` | right, but not news |
| Not sure | `unsure` | cannot tell whether it is right |
| Not useful | `not_useful` | not worth showing (wrong, beside the point or trivial) |

Before 4.3.0 there was no `unsure` or `not_useful`; earlier lines stay as they are (before 4.2.0
only `already_knew` was written; "Got it" recorded nothing). Lines written by 1.0.0 stay as they are.

A stored note that leaves without a button writes `{at, "gone": <reason>, check_at}`:
`"gone": "evicted"` when more than 50 notes were waiting and the oldest was dropped, `"gone":
"chat_gone"` when its chat was deleted. Before 4.4.0 these left no line. Before 4.4.0 check lines
have no `tone` or `enabled`: the report counts them as plain with every kind on.

**Review after week two:** how many checks, the total cost, the share of checks with a point
(expected to be a minority — most turns have nothing to flag), how many were `unreadable` or
`turn_unreadable`, how each point left (`asked`, `read`, `already_knew`, `unsure` and `not_useful`
lines, each counted against checks with a point; `not_useful` counts the false alarms), and whether the points were worth reading. For a side-by-side judgement, label an
offline evaluation run (README → "Offline evaluation"): tick "useful" or "noise" per point. If the
points are mostly noise, turn the plugin off — it is opt-in value, not a safety layer.

## Notes on disk (development phase)

For the development phase, while the notes' usefulness is measured, pending notes survive an app
restart. The backend keeps the text of each pending note — headline, sentence, chat title, model,
cost and who decided, plus the chat's id and the check's `at` — in
`<HERMES_HOME>/plugin-data/asterisk/notes.json` (the host's plugin storage,
`plugins.plugin_storage.plugin_data_dir`, so it follows the active profile), apart from the ledger,
which still holds no text. It keeps at most 50 notes; past that the oldest is dropped and one
`"gone": "evicted"` ledger line records it. "Ask in
chat", "Got it", "Already knew", "Not sure" and "Not useful" each remove the note from the file (`POST /dismiss`). At each app
start the desktop half asks for the pending notes (`POST /notes`, after `/status`, only when
Asterisk is on); a note whose chat no longer exists in the store is dropped then, with one
`"gone": "chat_gone"` ledger line. When the store cannot be opened nothing is dropped. Restored
notes do not unfold the strip or make the pet speak. The gone lines are written only after
`notes.json` was written.

Why 50 stays: at about 66 notes a day that is about 18 hours of notes, so a note left alone for about
a day leaves. The strip renders every pending note, so a larger cap would lengthen it without adding
ratings. The cap was measured to fire (at least 35 of 199 notes silently gone in 3 days); with the
`evicted` line it is a counted outcome ("Dropped" in the report) instead of a loss, so the right cap
can be decided later from the report.

- Notes from 4.1.0 are not carried over: 4.1.0 kept them in memory only and wrote none to disk.
- A downgrade or an uninstall leaves `notes.json` (and a `notes.json.tmp` from an interrupted write)
  on disk, unread (the core keeps `plugin-data` on remove). Delete the folder
  `<HERMES_HOME>/plugin-data/asterisk/` by hand.
- No storage (the host module missing or failing) never loses a point: `/check` still answers and
  writes its ledger line, `/dismiss` still records, and `/notes` answers 503 (one error notice).

**How to remove this later:** in `dashboard/plugin_api.py` delete the `NOTES_*` block (`NOTES_FILE`
through `notes()`), the `/notes` route, the keep call in `check()` and the drop call in
`dismiss()`; in `desktop/plugin.js` delete `restore()`, its call in `register` and the `gone` set;
delete their locks in `tests/check_api.py` and `tests/render_check.mjs`, their lines in
`tests/canary_audit.py` and the note parts of the `notes` rule in `tests/audit_static.py`; then
delete the file. The `storage` seam in `tests/contract_core.py`, the `plugin_data_dir` import and
`_data_file` stay: `settings.json` uses them. The report's `open` and `evicted` outcomes disappear
with the notes.

## Settings and the report

Settings → Plugins → Asterisk is one page with three sections: what it looks for, how it talks, and
how useful it is. It edits the active profile (the profile whose replies are checked).

**Where the settings live.** `<HERMES_HOME>/plugin-data/asterisk/settings.json`, beside `notes.json`
(the same host storage helper, so per profile): `{"tone": "plain" | "friendly" | "playful",
"enabled": [<kinds, in KINDS order>], "snoozed": {<kind>: <rated count>}}`. With no file, or a field
that cannot be read, that field takes its default: Plain, every kind on, nothing snoozed; the file is
never rewritten on read and a bad field never blocks a check. `/check` reads the settings once per
check, before the model call, so a change applies to the next check. With no storage `/check` uses
the defaults, `/report` answers with them, and `/settings` and `/keep` answer 503 `settings storage
unavailable`.

**Locked kinds.** `irreversible` and `security` (`LOCKED`) are always on: a missed irreversible step
or security risk costs the most, so the page shows their switch disabled with that reason,
`/settings` refuses a list without them (400 `irreversible and security are always on`), and a file
that lacks them still reads them as on. The priority order is shown, not editable.

**Enabled kinds.** A kind switched off is removed from the prompt: its bullet, its entry in the
priority list (an empty group is dropped and the rest renumbered) and its id in the JSON template
(`system_prompt(tone, enabled)` in `dashboard/plugin_api.py`). A point the model still writes for it
is filtered: no note, no notice, and the check line records `"filtered": [<kind>]` with `kinds` `[]`,
so the report counts it instead of losing it. An id outside `KINDS` is still unreadable (502).

**Tone.** Plain adds nothing (`SYSTEM_PROMPT = system_prompt("plain", KINDS)`). Friendly and Playful
each add one rule after the headline rule (the text is in `system_prompt`'s `_TONE_LINES`). From 4.5.0
the tone changes only the headline: the sentence stays plain and exact in every tone, and each rule
says the tone never changes whether there is a point, which point or its kind, and that an
irreversible or security point is always written plainly. Friendly writes a warm headline. Playful
writes a joke headline: built on one concrete detail of the turn (a file name, a command, a value, a
phrase from the reply), irony or comic understatement, aimed at the situation or the assistant, never
at the user, true; three example headlines from other turns set the register. The model writes four
`headline_options` first and picks the most surprising true one, never simply the first written.
Why this shape, from the 2026-10-20 trials (Sonnet, two hand-made turns, 5 calls per variant, about
$0.58 in all): "a light, witty touch" gave mild headlines and made up a file count ("50 files" for 47
in 4 of 5); a deadpan news-desk persona came out flat; with four candidates the model wrote funny
ones but picked the first, safest one until the rule said "most surprising, never the first" (then 7
of 10 picks were not the first). Brands that joke keep the joke in the mascot and the instructions
plain (Duolingo), and humour generation research finds choosing the best of many candidates is the
hard part (SemEval-2026 humour task, https://aclanthology.org/2026.semeval-1.15.pdf). "Ask in chat"
sends the kind's label instead of a Playful headline. Playful notes rated before prompt revision 2
do not count toward its suggestions (the style they rated is gone). There is no free-text tone: it would put the user's text
into the checker's instructions. The presets follow CodeRabbit's `tone_instructions`
(https://docs.coderabbit.ai/reference/configuration) and the NN/g tone dimensions
(https://www.nngroup.com/articles/tone-of-voice-dimensions/); the plain-writing rule follows the
finding that humour lowered short-term trust in an AI conveying information
(https://jcom.sissa.it/article/pubid/JCOM_2406_2025_A04/) and that humour in repeated warnings reads
as sarcasm (German UPA error-message heuristics). Whether a tone changes usefulness is not measured
yet: the report's "By tone" table is how it will be.

**Numbers the turn does not state.** In the 2026-10-20 trials the model rounded a count it did not
read: on a turn that wrote 47 files, the Plain prompt (the 4.4.0 prompt, unchanged) wrote "about 50
scratch files" in 2 of 5 sentences, and once "which likely breaks them" about files the turn never
ran; so the fault is the checker's, not a tone's. From 4.5.0 every tone's rules say a number in the
headline or the sentence is one the turn states or a count of at most ten things it names (any other
count is a word such as "dozens"), and never to state an outcome the turn does not show. The backend
then checks: every number in the headline and the sentence (digits, and English spelled numbers from
eleven to ninety-nine) that is not a whole number of at most 10 (`SMALL_COUNT`) must appear in the
text the model read (the redacted turn and the earlier block). When one does not: a Playful headline is
swapped for the first of its `headline_options` without one (no call, `numbers: "option"`); otherwise
one more call sends the first messages, the first answer and `NUMBERS_RULE` naming the numbers, and a
clean point of the same kind replaces the first (`"rewritten"`, its tokens and cost added to the
check's). A rewrite that fails, errs, changes the kind or still has one leaves the first point
(`"failed"`): a right warning with a wrong count beats no warning. Replacing the number in code
was rejected: the note is in the reply's language, and "dozens" in a Turkish sentence is broken. The
extra call costs about as much as a check (~1.5 cents on Sonnet) and runs only when needed. Not
covered: spelled numbers in other languages, and outcomes such as "breaks" (the prompt rule only).

**The report** (`POST /report {}`) is computed from the ledger, the pending `at` values in
`notes.json` and `settings.json`; it stores nothing new.

- A check line has a `points` key. A note is a check line with integer `points > 0` and non-empty
  `kinds`; its kind is `kinds[0]`, its key its `at`.
- A note's outcome is the first `feedback` line (a value in `SIGNALS`) or `gone` line whose
  `check_at` equals its `at`; otherwise `open` if its `at` is still pending in `notes.json`, otherwise
  `unrecorded` (notes from before 4.2.0, held in memory, and "Got it" before 4.2.0). Feedback values
  outside `SIGNALS` are ignored. `filtered` counts check lines with a filtered point.
- `skips` counts `skipped` lines by reason. `spend_usd` sums the finite, non-negative `cost_usd` of
  check lines; `unpriced` counts check lines without one; `cost_per_asked_usd` is spend divided by
  asked notes, null with none.
- Old lines: a check line without `tone` (or with an unknown one) counts as `plain`, one without
  `enabled` as every kind on (`checks_on`), a missing `model` as `unknown`, and a kind outside `KINDS`
  (1.x and 2.x kinds such as `action` or `deadline`) under `other`. A non-JSON or non-object line is
  skipped and counted in `unreadable_lines`.
- Tables: by kind (in `PRIORITY` order, then `other` when any), by model (the route that answered)
  and by tone (in `TONES` order), each with the outcomes `shown, filtered, asked, read, already_knew,
  unsure, not_useful, open, evicted, chat_gone, unrecorded`; model and tone rows add checks, spend and
  cost per asked note.

**Suggestions — suggest only, never automatic.** For each kind that is on and not locked, take its
rated notes (outcome `asked`, `already_knew` or `not_useful`; `read` and `unsure` count neither way)
under the current model (the `model` of the newest check line that has one) and the saved tone,
ordered by the time of their feedback line; keep the newest 20 (`SUGGEST_WINDOW`) and require at
least 10 (`SUGGEST_MIN`). `negative` is `already_knew` plus `not_useful` in that window. The page
offers "Turn off <kind>?" when the Wilson 95% lower bound (z = 1.96, `WILSON_Z`) of negative/rated
is above 0.5 (`SUGGEST_BOUND`): 9/10 → 0.596 yes, 8/10 → 0.490 no, 12/15 → 0.548 yes, 15/20 → 0.531
yes, 14/20 → 0.481 no. A model or tone change starts a new window, and so does Playful's new prompt
(`TONE_SINCE`: its notes from before `prompt` 2 are left out). The bound keeps a small sample
from acting on a few bad notes (https://www.evanmiller.org/how-not-to-sort-by-average-rating.html);
Qodo mutes a rule only after enough recorded outcomes, "a single ignored suggestion isn't enough"
(https://www.qodo.ai/blog/latest-updates-to-qodo-october-2026/), and Cursor Bugbot promotes and
disables learned rules as signal accumulates, editable in the UI (https://cursor.com/blog/bugbot-learning).
Nothing changes without a click: one user and small samples, and changing settings is the user's
decision. "Turn off" sends `/settings` without the kind (reversible with its switch, so not a
two-step action).

**Why counts, not days.** Notes per kind are very uneven: in the text-free ledger of 2026-10-18 to
2026-10-20 (375 checks, 199 notes, Sonnet 5.5 only) result had 97, overclaim 52, assumption 36,
overreach 7, unanswered, irreversible and tradeoff 2 each, security 1, constraint and cost 0. A fixed
two-week wait would act on one or two notes for a rare kind and wait needlessly for a frequent one.

**Keep and the snooze.** "Keep" (`POST /keep {kind}`) saves `snoozed[kind]` = that kind's all-time
rated count (any model or tone); its suggestion stays hidden until 10 more rated notes of the kind
arrive (`SNOOZE_MORE`). Switching a kind back on snoozes it the same way, so an old window does not
re-suggest it the moment it returns.

**Buttons.** No button is removed now. After 30 more dismissals, a button used in under 5% of dismissals is a removal candidate; the user decides.

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

Asterisk needs Hermes v0.21.6 or later, decided by seams, not by a version string. Which releases
are tested: CI's `core-versions` job runs `tests/contract_core.py` and `tests/core_smoke.py` (the
backend on the real core, with the core's own dependencies and a local fake model) on every stable
release from the README's minimum on, and on the pin; `audit_static.py` (`versions`) fails when the
README's minimum is not in that matrix. Add each new stable release to the matrix. The desktop half
is checked against each release's SDK source only. The desktop half
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
