# Changelog

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
- New ledger fields: `by`, `turn_chars`, `tool_results`, `truncated`, `turn_complete`; a
  `turn_unreadable` line when the turn could not be read. Still no text.
- Needs Hermes core v0.21.6 or later (`persisted_turn` on `message.complete`).
- `POST /check` takes `{session_id, turn}` instead of `{text}`: the desktop half and the backend must
  be updated together.
- `eval/compare_checkers.py`: an opt-in offline comparison of the 1.0.0 and 2.0.0 checkers on past
  turns (`--dry-run` calls no model).

## 1.0.0 (2026-10-11)

- First release. After a long reply (3,000+ characters) in a chat opened in the desktop app, a
  second model (Opus) reads the reply alone and returns at most three points of six kinds: cost,
  irreversible, security, your move, assumption, deadline. Nothing to flag shows nothing.
- Points arrive as one warning notice that stays until dismissed; the check's cost is in the notice;
  "Open chat" when the reply is in another chat; a line in the pet's bubble when a pet is on screen.
- A failed check is one named error notice. Each reply is checked once.
- The backend keeps a ledger per check (length, tokens, cost, point count and kinds; no text).
