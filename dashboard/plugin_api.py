"""You Should Know — the backend half: asks a second model what a long reply must not let slip.

Route (mounted at /api/plugins/you-should-know/):
  POST /check  {text}  -> {points: [{kind, text}], cost_usd, cost_status, chars}

The desktop half calls it for a finished reply of a chat the user opened, once per reply, when the
reply is long (MIN_CHARS). The model reads the reply only — never the conversation, never a file —
and returns at most MAX_POINTS points that the reply itself states. No point is the common answer.

What it writes: one line per check to <HERMES_HOME>/state/you-should-know/ledger.jsonl — time, reply
length, tokens, cost, how many points and their kinds. Never the reply's text or the points' text.
That ledger is what the cost review reads (see Docs/you-should-know-notes.md).
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException

log = logging.getLogger(__name__)
router = APIRouter()

PLUGIN_ID = "you-should-know"
PROVIDER = "anthropic"
MODEL = "claude-opus-5-5"
MIN_CHARS = 3000
# A reply longer than this is sent as its head and its tail: a warning sits at the start (this
# user's rule puts it first) or in the closing lines far more often than in the middle.
MAX_CHARS = 40000
MAX_POINTS = 3
MAX_POINT_CHARS = 240
MAX_OUTPUT_TOKENS = 700
TIMEOUT_S = 90
KINDS = ("cost", "irreversible", "security", "action", "assumption", "deadline")

SYSTEM_PROMPT = f"""You read a reply an AI assistant wrote to its user. The user may only skim it.
Find what the user must not miss, among only these kinds:
- cost: money will be spent or charged, or a price or quota matters
- irreversible: a step that deletes, overwrites, publishes or cannot be undone
- security: credentials, secrets, permissions, exposure, a safety risk
- action: something the user personally has to do, decide or approve
- assumption: an assumption, uncertainty or unverified claim that changes the result
- deadline: a date or time limit

Rules:
- Only what the reply itself states. Never invent, infer beyond it, or add your own advice.
- Skip what is routine or already obvious from the reply's first lines.
- Most replies have nothing to flag. Then return no points.
- At most {MAX_POINTS} points, the most important first. One sentence each, under 200 characters,
  in the same language as the reply.

Answer with JSON only, no prose, no code fence:
{{"points": [{{"kind": "<one of: {', '.join(KINDS)}>", "text": "<the point>"}}]}}"""

_ledger_lock = threading.Lock()


def _home() -> Path:
    configured = os.environ.get("HERMES_HOME")
    if configured:
        return Path(configured)
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:  # noqa: BLE001 — outside the gateway (tests) the env var decides
        local = os.environ.get("LOCALAPPDATA")
        return Path(local) / "hermes" if local else Path.home() / ".hermes"


def _ledger_path() -> Path:
    return _home() / "state" / PLUGIN_ID / "ledger.jsonl"


def _clip(text: str) -> str:
    """The reply as sent: whole when it fits, else its head and tail with a marked cut."""
    if len(text) <= MAX_CHARS:
        return text
    half = MAX_CHARS // 2
    return f"{text[:half]}\n\n[... {len(text) - MAX_CHARS} characters cut ...]\n\n{text[-half:]}"


def _call_llm(messages: list[dict]):
    from agent.auxiliary_client import call_llm
    return call_llm(task="you_should_know", provider=PROVIDER, model=MODEL, messages=messages,
                    max_tokens=MAX_OUTPUT_TOKENS, timeout=TIMEOUT_S)


def _content(response) -> str:
    from agent.auxiliary_client import extract_content_or_reasoning
    return extract_content_or_reasoning(response)


def _cost(response) -> tuple[int, int, float | None, str]:
    """(input tokens, output tokens, usd, status) from Hermes' own pricing; never a guess.

    The auxiliary client hands back a chat-completions response, so its usage is read in that
    shape: naming the provider here would read it as Anthropic's shape and count zero tokens.
    """
    try:
        from agent.usage_pricing import estimate_usage_cost, normalize_usage
        usage = normalize_usage(getattr(response, "usage", None))
        result = estimate_usage_cost(MODEL, usage, provider=PROVIDER)
        amount = float(result.amount_usd) if result.amount_usd is not None else None
        return usage.input_tokens, usage.output_tokens, amount, str(result.status)
    except Exception as exc:  # noqa: BLE001 — a missing price must not hide the points
        log.warning("you-should-know: cost unavailable (%s: %s)", type(exc).__name__, exc)
        return 0, 0, None, "unknown"


def _parse(raw: str) -> list[dict]:
    """The model's JSON as points; anything else is an error, never an empty answer."""
    text = raw.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, re.S)
    if fenced:
        text = fenced.group(1)
    data = json.loads(text)
    points = data.get("points") if isinstance(data, dict) else None
    if not isinstance(points, list):
        raise ValueError("no points list")
    out = []
    for p in points:
        if not isinstance(p, dict):
            continue
        kind, body = p.get("kind"), p.get("text")
        if kind not in KINDS or not isinstance(body, str) or not body.strip():
            continue
        body = " ".join(body.split())
        out.append({"kind": kind, "text": body if len(body) <= MAX_POINT_CHARS else body[:MAX_POINT_CHARS - 1] + "…"})
    return out[:MAX_POINTS]


def _record(entry: dict) -> None:
    path = _ledger_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with _ledger_lock, path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError as exc:
        log.warning("you-should-know: ledger not written (%s)", type(exc).__name__)


def check(text: str, now: float | None = None) -> dict:
    if not isinstance(text, str):
        raise HTTPException(status_code=400, detail="text must be a string")
    if len(text) < MIN_CHARS:
        raise HTTPException(status_code=400, detail=f"reply shorter than {MIN_CHARS} characters")
    messages = [{"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"The reply:\n\n{_clip(text)}"}]
    started = time.monotonic()
    try:
        response = _call_llm(messages)
    except Exception as exc:  # noqa: BLE001 — named to the user, the full error only logged
        log.warning("you-should-know: model call failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"model call failed ({type(exc).__name__})") from exc
    tokens_in, tokens_out, usd, status = _cost(response)
    entry = {"at": round(now if now is not None else time.time(), 3), "chars": len(text),
             "model": MODEL, "input_tokens": tokens_in, "output_tokens": tokens_out,
             "cost_usd": usd, "cost_status": status, "seconds": round(time.monotonic() - started, 2)}
    try:
        points = _parse(_content(response))
    except (ValueError, TypeError) as exc:
        _record({**entry, "points": None, "error": "unreadable"})
        log.warning("you-should-know: model answer unreadable (%s)", type(exc).__name__)
        raise HTTPException(status_code=502, detail="model answer unreadable") from exc
    _record({**entry, "points": len(points), "kinds": [p["kind"] for p in points]})
    return {"points": points, "cost_usd": usd, "cost_status": status, "chars": len(text)}


@router.post("/check")
def check_route(body: dict):
    return check(body.get("text") if isinstance(body, dict) else None)
