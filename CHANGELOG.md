# Changelog

## 1.0.0 (2026-10-11)

- First release. After a long reply (3,000+ characters) in a chat opened in the desktop app, a
  second model (Opus) reads the reply alone and returns at most three points of six kinds: cost,
  irreversible, security, your move, assumption, deadline. Nothing to flag shows nothing.
- Points arrive as one warning notice that stays until dismissed; the check's cost is in the notice;
  "Open chat" when the reply is in another chat; a line in the pet's bubble when a pet is on screen.
- A failed check is one named error notice. Each reply is checked once.
- The backend keeps a ledger per check (length, tokens, cost, point count and kinds; no text).
