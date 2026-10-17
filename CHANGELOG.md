# Changelog

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
