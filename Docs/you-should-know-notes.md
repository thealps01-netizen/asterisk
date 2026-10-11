# You Should Know — design notes

## What it is for

Long replies hide the one line that matters: a charge, a step that cannot be undone, something only
the user can do. You Should Know lifts those lines out. It is the "You Should Know" mod from the
Claude Code mods video (2026-10), rebuilt on Hermes' own extension points.

## How it works

1. The desktop half listens to `message.complete`. A frame is checked when it has status `complete`,
   is not `response_reused`, its text is at least **3,000** characters, and its runtime session is a
   chat the user has opened in this app (a subagent's mirrored frame carries no status and is never
   checked; background chats never opened here are not checked).
2. It posts the whole reply to the plugin's own backend, `POST /api/plugins/you-should-know/check`.
3. The backend asks `claude-opus-5-5` on the `anthropic` provider through Hermes' auxiliary client
   (`call_llm`, task `you_should_know`, 700 output tokens, 90 s). The model sees the reply only, never
   the conversation or a file. Over 40,000 characters it sees the head and the tail.
4. The answer is strict JSON: at most three points, known kinds only. An answer that is not that is
   an error, never read as "nothing to flag".
5. Points become one warning notice (the app does not auto-dismiss warnings). No points, no notice.

## Cost

Opus at Hermes' price table: about $0.02 for a 2,500-token reply with a short answer; the price
scales with the reply. At ~25 long replies a day that is roughly $0.50/day, $15/month. The real
figure is in the ledger, not in this estimate.

Usage is read in the chat-completions shape, because that is what the auxiliary client returns.
Naming the provider when reading it would read the Anthropic shape and count zero tokens.

## The ledger

`<HERMES_HOME>/state/you-should-know/ledger.jsonl`, one line per check: time, reply length, model,
input/output tokens, cost and its status, seconds, point count and kinds. Never the reply's text or
a point's text. A failed call writes no line; an unreadable answer writes one with
`"error": "unreadable"`.

**Review after a week:** how many checks, the total cost, and the share with points. If nearly every
check returns nothing, or the points were not worth reading, turn the plugin off — it is opt-in
value, not a safety layer.

## What it does not do

- It does not block, delay or rewrite the reply. It only adds a notice after.
- It does not judge the assistant. It reports what the reply itself says.
- It is not a safety layer: a missed point is possible. The assistant's own rules (warnings first)
  stay the first line.

## Turning it off

Settings → Plugins → You Should Know → off (or remove `desktop-plugins/you-should-know`). The
backend route then sees no calls.
