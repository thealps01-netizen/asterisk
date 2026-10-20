# Changelog

## 4.4.0 (2026-10-20)

- A settings page, Settings → Plugins → Asterisk, saved per profile in
  `plugin-data/asterisk/settings.json`: switch each kind on or off (Irreversible step and Security
  risk are always on; a kind switched off is removed from the prompt, and a point the model still
  writes for it is filtered and counted, never shown), and choose the tone, Plain (default),
  Friendly or Playful (wording only; irreversible and security notes stay plain). Changes apply to
  the next check.
- "How useful it is": checks, notes, spend and cost per asked note, and how each note left, by kind,
  by model and by tone, computed from the text-free ledger. When a kind's last rated notes under the
  current model and tone are mostly Not useful or Already knew (Wilson 95% lower bound above 0.5 over
  the newest 20, at least 10), the page suggests turning it off; "Turn off" and "Keep" (hide it until
  10 more rated notes). Nothing changes without a click.
- New endpoints: `POST /report`, `POST /settings {tone, enabled}` and `POST /keep {kind}`.
- Ledger: check and unreadable lines add `tone` and `enabled` (and `filtered` for a filtered point);
  a note that leaves without a button now writes `{at, gone: "evicted" | "chat_gone", check_at}`
  (more than 50 waiting, or its chat deleted) instead of leaving no trace. No text is added.
- No change to what is checked by default, the trigger or how the model is chosen: with no settings saved the prompt is byte-identical to 4.3.0.
- The desktop half and the backend must come from the same release (a 4.3.0 backend answers 404 to /report: the page shows its load error).

## 4.3.0 (2026-10-18)

- Two more buttons, "Not sure" and "Not useful", on every note that shows its sentence (the chat you
  are in and another chat), next to "Already knew": "Not sure" for a note you cannot tell is right,
  "Not useful" for a note that was not worth showing (wrong, beside the point or trivial). One click,
  no reason asked: the note leaves the strip, its copy in `plugin-data/asterisk/notes.json` is
  removed, and the ledger gets one line `{at, feedback: "unsure" | "not_useful", check_at}` without
  any text. "Already knew" now means only "right, but not news".
- The five ways a note leaves: `asked` (Ask in chat), `read` (Got it), `already_knew` (Already knew),
  `unsure` (Not sure) and `not_useful` (Not useful). `POST /dismiss` accepts `unsure` and
  `not_useful`; ledger lines written before stay as they are.
- No change to what is checked, the prompt, the trigger, how the model is chosen or what is stored.
  The desktop half and the backend must come from the same release: a 4.2.0 backend refuses
  "Not sure" and "Not useful" (one "Could not record" error) and the note comes back at the next
  start.

## 4.2.0 (2026-10-18)

- Note text is now kept on disk until you dismiss the note, as a development-phase measure: it lets
  notes survive an app restart while their usefulness is measured, and will be turned off later. Each
  pending note's headline, sentence, chat title, model and cost sit in
  `plugin-data/asterisk/notes.json` in your Hermes home (at most 50 notes, oldest dropped), apart from
  the ledger, which still holds no text. "Ask in chat", "Got it" and "Already knew" each remove it; a
  note whose chat was deleted is dropped at the next start. Uninstalling Asterisk leaves the file;
  delete it by hand.
- "Ask in chat" on a note of the chat you are in puts the note into that chat's input, after anything
  you have typed, for you to edit and send. It never sends by itself, so no turn on your main model
  starts until you press send. The note then leaves the strip. A note of another chat keeps "Open".
- A chevron in the strip's header folds it to one line ("Worth knowing · 3 notes" with the accent
  stroke). The notes stay; a new note unfolds it.
- Each way a note leaves is recorded in the ledger, without any text: `asked` (Ask in chat), `read`
  (Got it, which recorded nothing before) and `already_knew` (as before). `POST /feedback` is now
  `POST /dismiss {check_at, signal}`, and `POST /notes` returns the pending notes.
- Notes from before the upgrade are not carried over: 4.1.0 kept them in memory only. No change to
  what is checked, the prompt, the trigger or how the model is chosen. The desktop half and the
  backend must come from the same release.

## 4.1.0 (2026-10-18)

- Cost first: far more turns are checked now, so the cost can rise about five times. On one user's
  history, about 75 checks per active day instead of 14 (about $4 a day instead of $0.74 at 5.3 cents
  a check on `claude-opus-5-5`); a cheaper model on the Asterisk row lowers it. What a short-reply
  check costs is not measured yet.
- A turn is now checked when the assistant used a tool that can change something (wrote a file, ran a
  command, ...), even with a short reply, or when the reply is long (3,000+ characters, as before).
  Which tools only read is Hermes' own list (`tool_may_have_side_effect`); a terminal command always
  counts. The backend decides; the desktop half sends every finished reply of a chat you opened.
- Four new kinds of point: a request the reply did not answer (`unanswered`), work the reply claims
  but the turn did not do (`overclaim`), something you said not to do that was done (`constraint`),
  and something you did not ask for (`overreach`). `result` also covers a definite value taken from
  an empty, cut, stale, malformed or failed tool result. When several apply, one is chosen by a fixed
  order: irreversible and security first, then unanswered, overclaim and constraint, then result and
  cost, then tradeoff, assumption and overreach. How many notes and how much noise the new kinds bring
  is not measured yet.
- The check also reads your last five earlier messages in the chat (yours only, never the assistant's
  replies or tool results; redacted; at most 500 characters each and 2,000 together), so a rule or a
  request you gave before can be seen. Ledger lines gain `earlier_chars` (a length, no text).
- Fixed: "Could not check a long reply: … turn ids missing or malformed" after a compaction during
  the turn. A turn Hermes cannot prove (no receipt, a missing user or final row id, more than 500
  rows, rows archived by compaction, a first row that is not your own message) is now skipped
  silently and recorded as a ledger line `{at, skipped}` with the reason and no text. A malformed
  request is still an error.
- The error notice now says "Could not check a reply". No change to the strip's look or to how the
  model is chosen. The desktop half and the backend must come from the same release.

## 4.0.0 (2026-10-17)

- The model is yours to choose. Asterisk registers its own auxiliary task: an "Asterisk" row in
  Settings → Models → Auxiliary models, where you pick the provider and model from your connected
  accounts. The backend no longer names one (3.0.0 sent every check to `claude-opus-5-5` on
  `anthropic`, whatever the user had).
- Breaking: until a model is chosen on that row, Asterisk checks nothing: `/check` answers 409 "no model
  chosen" before reading anything, and the desktop half says where to choose, once per app start.
  It never falls back to your main model on its own; "Set to main" on the row is how to use it.
  From 3.0.0: choose a model once (Opus 5.5 on Anthropic is what 3.0.0 used).
- `POST /check` also returns `model`, the model that answered; the strip names it where it said
  "Opus". Ledger lines gain `provider`, and `model` is the model that answered (a fallback
  included); the cost is priced for it.
- Cost and quality are measured only for `claude-opus-5-5` (about $0.05 a check). Other models are
  not measured.
- No change to what is checked, the prompt or the strip's look. The desktop half and the backend
  must come from the same release.

## 3.0.0 (2026-10-17)

- Renamed to Asterisk. Every identifier that carried the old name now says `asterisk`: the plugin
  folder `plugins/asterisk`, the desktop half `desktop-plugins/asterisk`, the routes
  `/api/plugins/asterisk/check`, `/api/plugins/asterisk/feedback` and the new
  `/api/plugins/asterisk/status`, the auxiliary task `asterisk`, the ledger
  `state/asterisk/ledger.jsonl` and the evaluation output `state/asterisk/eval/`. Breaking for
  anything that called the old routes or read the old paths.
- Install and update from the Hermes app: Capabilities → Plugins → Install from Git with the
  repository URL, and the row's Update button. No terminal and no copying by hand.
- Upgrading from 2.x: uninstall the `you-should-know` row, then install Asterisk. The first ledger
  line copies the 2.x ledger to `state/asterisk/ledger.jsonl` once, byte for byte; the old
  `state/you-should-know/` folder is left as it was.
- While the 2.x package is still installed in the same profile, Asterisk stands down: `/check`
  answers 409 and the desktop half stops checking and says so once per app start, so no reply is
  checked twice.
- On a Hermes too old for Asterisk (a desktop SDK or a core without the seams it uses) it stays off
  (on an old desktop it registers nothing) and shows one "update Hermes" notice, once per profile:
  the backend remembers it with an empty flag file, `state/asterisk/update-hermes-notice`. The
  desktop half imports the SDK as a namespace, so an old app loads it instead of failing.
- No change to what is checked, the prompt or the strip.

## 2.1.0 (2026-10-17)

- The "Worth knowing" headline strip above the input replaces the warning toast: the point as a
  short headline in a serif, underlined by a stroke in the theme's accent, with its sentence, the
  check's cost and who decided, and "Already knew" / "Got it". A note stays until one of the two
  removes it.
- Several notes show as a numbered list in arrival order: the focused chat's note expanded, each
  other one a single line with its chat's title, the cost and "Open" (opens that chat, keeps the note).
- A dot in the theme's accent on the sidebar row of every chat with a pending note.
- Colours come from the app's theme tokens only (accent, text, strokes), so the strip follows the
  theme in light and dark. Reduced motion: no stroke drawing and no stagger.
- The answer gains a `headline` field (asked at most 60 characters, kept at most 80); a point without
  one is an unreadable answer, never shown.
- `POST /check` also returns the check's `at` and the chat's `title` (null when it cannot be read).
- `POST /feedback {check_at}` records "Already knew" as an `already_knew` ledger line with the check's
  `at` and no text. "Got it" records nothing.
- Pending notes live in memory only and are gone after a restart.
- The desktop half and the backend must come from the same release.
- `tests/package.json` pins React and jsdom to the core desktop app's versions: run `npm ci` in
  `tests/` before the gates. `tests/preview_strip.mjs` writes light/dark previews for review (not a
  gate).

## 2.0.0 (2026-10-17)

- Reads the whole last turn, not the reply alone: the user's message, the assistant's tool calls and
  their results, and the final reply, read-only from the profile's own store by the frame's
  `persisted_turn` row ids. Every piece is redacted (Hermes' redactor, forced) and capped (32,000
  characters a turn, oldest steps dropped first); reasoning is never sent. A literal `<turn>` or
  `</turn>` in that text is rewritten to `[turn]` / `[/turn]`, so it cannot break the prompt's frame.
- At most one point, or none (the normal answer): something the turn shows that the reply did not
  plainly say, and who decided it (`by`: the assistant or the user).
- Six new kinds: tradeoff, result may be off, assumption, cannot be undone, security, cost. "Your
  move" and "Deadline" are gone. The notice shows the one point; there is no detail.
- Stricter answer schema: two points, an unknown kind or a missing `by` is an error, never trimmed or
  read as nothing to flag. A turn that cannot be read is a named error too.
- A point names the final reply's language before its text, and the request ends with the rule to
  write in that language: points about Turkish replies were coming back in English.
- New ledger fields: `by`, `turn_chars`, `tool_results`, `truncated`, `turn_complete`; a
  `turn_unreadable` line when the turn could not be read. Still no text.
- Needs Hermes core v0.21.6 or later (`persisted_turn` on `message.complete`).
- `POST /check` takes `{session_id, turn}` instead of `{text}`: the desktop half and the backend must
  be updated together.
- `eval/compare_checkers.py`: an opt-in offline comparison of the 1.0.0 and 2.0.0 checkers on past
  turns (`--dry-run` calls no model). It starts Hermes itself (`--core`, `HERMES_CORE` or
  `<HERMES_HOME>/hermes-agent`), so any Python that can start Hermes runs it.
- Cost, measured on 14 turns: about $0.05 a check (range $0.02–0.08), against about $0.019 for 1.0.0.

## 1.0.0 (2026-10-11)

- First release. After a long reply (3,000+ characters) in a chat opened in the desktop app, a
  second model (Opus) reads the reply alone and returns at most three points of six kinds: cost,
  irreversible, security, your move, assumption, deadline. Nothing to flag shows nothing.
- Points arrive as one warning notice that stays until dismissed; the check's cost is in the notice;
  "Open chat" when the reply is in another chat; a line in the pet's bubble when a pet is on screen.
- A failed check is one named error notice. Each reply is checked once.
- The backend keeps a ledger per check (length, tokens, cost, point count and kinds; no text).
