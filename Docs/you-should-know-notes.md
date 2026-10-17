# You Should Know — design notes

## What it is for

Long replies hide the one thing that matters, and the reply is not the whole story: the assistant
made choices along the way — in its tool calls and in what their results showed — that the reply may
not mention. You Should Know rereads the whole turn and names, at most, the one thing the user
should know but would miss from the reply alone, and who decided it. It is the "You Should Know"
mod from the Claude Code mods video (2026-10), rebuilt on Hermes' own extension points.

## How it works

1. The desktop half listens to `message.complete`. A frame is checked when it has status `complete`,
   is not `response_reused`, its text is at least **3,000** characters, and its runtime session is a
   chat the user has opened in this app (a subagent's mirrored frame carries no status and is never
   checked; background chats never opened here are not checked). Each reply is checked once.
2. It posts `{session_id, turn}` to the plugin's own backend, `POST /api/plugins/you-should-know/check`:
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
   Reasoning is never sent.
5. Caps, in characters (a cut piece keeps its head and its tail, with a marked cut): user message
   4,000; each intermediate step 2,000; tool call arguments 600; each tool result **2,000**; final
   reply 16,000. The whole turn is at most **32,000**: over that, whole steps are dropped oldest
   first and one line says how many; the user's message and the final reply are never dropped.
6. The backend asks `claude-opus-5-5` on the `anthropic` provider through Hermes' auxiliary client
   (`call_llm`, task `you_should_know`, 700 output tokens, 90 s). The answer is strict JSON: no point,
   or one point with a kind (`tradeoff`, `result`, `assumption`, `irreversible`, `security`, `cost`),
   `by` (`assistant` or `user`) and one sentence. Two points, an unknown kind or a missing `by` is an
   error, never trimmed and never read as "nothing to flag".
7. One point becomes one warning notice (the app does not auto-dismiss warnings). No point, no notice.

## Cost

An **estimate**, from Hermes' price table for Opus 5.5 ($4 per million input tokens, $20 per million
output) at about 2.5 characters per token: a turn without tools is about 2,500 input tokens, about
$0.012; a typical turn with tools (about 19,000 characters) about $0.036; a turn at the 32,000 cap
about $0.06–0.07; the answer adds about $0.003 (at most $0.014). So about 1–7 cents a check (up to
about 8 with the longest answer), typically 3–4 cents, against 1.0.0's $0.016 median. At ~15 checks a
day that is about $0.50/day, $15/month. The real figure is in the ledger, not in this estimate.

Usage is read in the chat-completions shape, because that is what the auxiliary client returns.
Naming the provider when reading it would read the Anthropic shape and count zero tokens.

## The ledger

`<HERMES_HOME>/state/you-should-know/ledger.jsonl`, one line per check: time, final reply length,
model, input/output tokens, cost and its status, seconds, `points` (0 or 1), `kinds`, `by` (null,
`assistant` or `user`), `turn_chars`, `tool_results`, `truncated`, and `turn_complete` (the receipt's
own flag). Never any text: not the turn, not the reply, not the point. A failed call writes no line;
an unreadable answer writes one with `"points": null, "error": "unreadable"`; a turn that could not be
read writes `{at, model, "error": "turn_unreadable"}`. Lines written by 1.0.0 stay as they are.

**Review after week two:** how many checks, the total cost, the share of checks with a point
(expected to be a minority — most turns have nothing to flag), how many were `unreadable` or
`turn_unreadable`, and whether the points were worth reading. For a side-by-side judgement, label an
offline evaluation run (README → "Offline evaluation"): tick "useful" or "noise" per point. If the
points are mostly noise, turn the plugin off — it is opt-in value, not a safety layer.

## What it does not do

- It does not block, delay or rewrite the reply. It only adds a notice after.
- It names the assistant's unstated choices (and the user's own, when the user asked for them); it
  does not grade the assistant or add advice of its own.
- It reads the last turn only, never earlier turns, and no file beyond what the turn's tool results
  already contain. It does not read reasoning.
- It is not a safety layer: a missed point is possible. The assistant's own rules (warnings first)
  stay the first line.

## Turning it off

Settings → Plugins → You Should Know → off (or remove `desktop-plugins/you-should-know`). The
backend route then sees no calls.
