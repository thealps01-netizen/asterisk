"""You Should Know — the backend half against a fake model and a fake pricing table.

Run: python check_api.py [path/to/plugin_api.py]      (exit 0 = passed)

The core's auxiliary client and pricing module are replaced by fakes that behave like the real
ones where it matters (contract_core.py checks the real ones still do):
  - call_llm returns a chat-completions response (usage as prompt_tokens / completion_tokens);
  - normalize_usage reads that shape when no provider is named, and reads ZERO tokens when told
    the provider is anthropic (the Anthropic shape) — the trap the backend must not fall into.

Locks:
  1. Input: a non-string or a reply under 3000 characters is a 400; nothing is sent or recorded.
  2. The call: Opus on anthropic, the plugin's task name, a bounded answer and timeout; the system
     prompt names every kind; the reply goes in whole, or as head + tail with a marked cut.
  3. Answers: only known kinds, at most 3, whitespace collapsed, long points cut with an ellipsis;
     a fenced JSON answer is read; an unreadable answer is a 502, never an empty "nothing to flag".
  4. A failed call is a 502 that names the error type, not its message.
  5. Cost: tokens read in the chat shape (nonzero), priced by Hermes' table; a pricing failure still
     returns the points, with cost unknown.
  6. Ledger: one line per check with length, tokens, cost, point count and kinds — never the reply's
     text or a point's text; an unreadable answer is recorded as such; a failed call is not.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent / "dashboard" / "plugin_api.py"

failures = 0


def check(ok: bool, what: str) -> None:
    global failures
    print(f"{'PASS' if ok else 'FAIL'}  {what}")
    if not ok:
        failures += 1


# ── fakes for the core ───────────────────────────────────────────────────────
class Fake:
    answer = '{"points": []}'
    raises: Exception | None = None
    calls: list[dict] = []
    price_raises = False


def call_llm(**kwargs):
    Fake.calls.append(kwargs)
    if Fake.raises:
        raise Fake.raises
    usage = types.SimpleNamespace(prompt_tokens=2500, completion_tokens=300, total_tokens=2800)
    return types.SimpleNamespace(model=kwargs.get("model"), usage=usage, answer=Fake.answer)


def extract_content_or_reasoning(response, **_):
    return response.answer


class CanonicalUsage(types.SimpleNamespace):
    pass


def normalize_usage(usage, *, provider=None, api_mode=None):
    if provider == "anthropic" or api_mode == "anthropic_messages":
        return CanonicalUsage(input_tokens=getattr(usage, "input_tokens", 0) or 0,
                              output_tokens=getattr(usage, "output_tokens", 0) or 0)
    return CanonicalUsage(input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens)


def estimate_usage_cost(model, usage, *, provider=None, **_):
    if Fake.price_raises:
        raise ModuleNotFoundError("providers")
    from decimal import Decimal
    amount = (Decimal(usage.input_tokens) * Decimal("5") + Decimal(usage.output_tokens) * Decimal("25")) / Decimal(1_000_000)
    return types.SimpleNamespace(amount_usd=amount.quantize(Decimal("0.0001")), status="estimated")


agent = types.ModuleType("agent")
aux = types.ModuleType("agent.auxiliary_client")
aux.call_llm, aux.extract_content_or_reasoning = call_llm, extract_content_or_reasoning
pricing = types.ModuleType("agent.usage_pricing")
pricing.normalize_usage, pricing.estimate_usage_cost = normalize_usage, estimate_usage_cost
sys.modules.update({"agent": agent, "agent.auxiliary_client": aux, "agent.usage_pricing": pricing})

home = Path(tempfile.mkdtemp(prefix="ysk-home-"))
os.environ["HERMES_HOME"] = str(home)
spec = importlib.util.spec_from_file_location("ysk_api", API)
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
from fastapi import HTTPException  # noqa: E402

LEDGER = home / "state" / "you-should-know" / "ledger.jsonl"
REPLY = "Here is the plan. " * 200 + "SECRET-REPLY-MARKER"


def ledger() -> list[dict]:
    return [json.loads(line) for line in LEDGER.read_text(encoding="utf-8").splitlines()] if LEDGER.exists() else []


def status_of(fn, *args):
    try:
        fn(*args)
    except HTTPException as exc:
        return exc.status_code, exc.detail
    return None, None


# 1. input
check(status_of(api.check, None)[0] == 400 and status_of(api.check, "short")[0] == 400, "a non-string or a short reply is a 400")
check(status_of(api.check, "x" * 2999)[0] == 400 and status_of(api.check_route, "not a dict")[0] == 400, "2999 characters, or a body that is not an object, is a 400")
check(not Fake.calls and not ledger(), "a refused reply is neither sent nor recorded")

# 2. the call, 3. a clean answer
Fake.answer = json.dumps({"points": [
    {"kind": "cost", "text": "Running it   costs\n~$30 a month."},
    {"kind": "made-up", "text": "dropped"},
    {"kind": "action", "text": ""},
    {"kind": "irreversible", "text": "It deletes " + "very " * 80 + "old backups."},
    {"kind": "security", "text": "The token is printed."},
    {"kind": "deadline", "text": "a fourth valid point is one too many"},
]})
out = api.check(REPLY, now=1000.0)
call = Fake.calls[-1]
check(call.get("provider") == "anthropic" and call.get("model") == "claude-opus-5-5" and call.get("task") == "you_should_know",
      f"Opus on anthropic under the plugin's task ({call.get('provider')}, {call.get('model')}, {call.get('task')})")
check(call.get("max_tokens") == 700 and call.get("timeout") == 90, "a bounded answer and timeout")
system, user = call["messages"][0]["content"], call["messages"][1]["content"]
check(all(k in system for k in api.KINDS) and "Most replies have nothing to flag" in system and "same language as the reply" in system,
      "the system prompt names every kind, says no point is the common answer, and keeps the reply's language")
check(user.endswith(REPLY), "the reply goes in whole")
kinds = [p["kind"] for p in out["points"]]
check(kinds == ["cost", "irreversible", "security"], f"only known kinds, non-empty, at most 3, in order ({kinds})")
check(out["points"][0]["text"] == "Running it costs ~$30 a month.", f"whitespace is collapsed ({out['points'][0]['text']!r})")
check(len(out["points"][1]["text"]) == 240 and out["points"][1]["text"].endswith("…"), "a long point is cut to 240 with an ellipsis")
check(out["cost_usd"] == 0.02 and out["cost_status"] == "estimated" and out["chars"] == len(REPLY),
      f"cost from the chat-shaped usage, priced ({out['cost_usd']}, {out['cost_status']})")

# 6. ledger
rows = ledger()
row = rows[-1] if rows else {}
check(len(rows) == 1 and row.get("points") == 3 and row.get("kinds") == ["cost", "irreversible", "security"]
      and row.get("input_tokens") == 2500 and row.get("output_tokens") == 300 and row.get("cost_usd") == 0.02
      and row.get("chars") == len(REPLY) and row.get("at") == 1000.0, f"one ledger line with length, tokens, cost and kinds ({row})")
raw = LEDGER.read_text(encoding="utf-8")
check("SECRET-REPLY-MARKER" not in raw and "costs" not in raw and "token is printed" not in raw,
      "the ledger holds neither the reply's text nor a point's text")

# 2. a very long reply: head and tail
big = "HEAD " + "x" * 60000 + " TAIL"
Fake.answer = '```json\n{"points": []}\n```'
out = api.check(big)
sent = Fake.calls[-1]["messages"][1]["content"]
check("HEAD" in sent and sent.endswith("TAIL") and "characters cut" in sent and len(sent) < api.MAX_CHARS + 200,
      f"a reply over 40000 characters goes as head + tail with a marked cut ({len(sent)} sent)")
check(out["points"] == [], "a fenced JSON answer is read; no points is a valid answer")

# 3. unreadable answer
for bad in ("I think nothing here.", '{"point": []}', "[1, 2]"):
    Fake.answer = bad
    code, detail = status_of(api.check, REPLY)
    check(code == 502 and detail == "model answer unreadable", f"an unreadable answer is a 502, not 'nothing to flag' ({bad!r})")
check(ledger()[-1].get("error") == "unreadable" and ledger()[-1].get("points") is None, "an unreadable answer is recorded as such")

# 4. failed call
count = len(ledger())
Fake.raises = TimeoutError("api.anthropic.com timed out after 90s with key sk-ant-XYZ")
code, detail = status_of(api.check, REPLY)
check(code == 502 and detail == "model call failed (TimeoutError)", f"a failed call names the error type, not its message ({detail})")
check(len(ledger()) == count, "a failed call writes no ledger line")
Fake.raises = None

# 5. pricing failure
Fake.price_raises = True
Fake.answer = '{"points": [{"kind": "deadline", "text": "Due Friday."}]}'
out = api.check(REPLY)
check(out["points"] == [{"kind": "deadline", "text": "Due Friday."}] and out["cost_usd"] is None and out["cost_status"] == "unknown",
      "a pricing failure keeps the points and says the cost is unknown")
Fake.price_raises = False

print(f"\n{failures} FAILED" if failures else "\nALL PASSED")
sys.exit(1 if failures else 0)
