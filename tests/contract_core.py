"""You Should Know — the seams the plugin uses in the Hermes core still exist and still mean the same.

Run: python contract_core.py [--core <hermes-agent checkout>]      (exit 0 = the contract holds)
     python contract_core.py --selftest                              (each seam fails on a broken copy)

The fakes in check_api.py and render_check.mjs stand in for these; this is what keeps them honest.

Seams:
  frame        message.complete carries status (with "complete") and response_reused
  llm          agent.auxiliary_client.call_llm(task, provider, model, messages, max_tokens, timeout)
               and extract_content_or_reasoning(response) exist
  usage        the chat usage shape reads prompt_tokens / completion_tokens, and the Anthropic shape
               does not (why the backend names no provider when it reads usage)
  pricing      estimate_usage_cost and the cost statuses actual / estimated / included / unknown
  notify       a warning notice stays until dismissed (no auto-dismiss), like an error
  host         host.notify, host.openSession, host.state.focusedSessionId / focusedStoredSessionId
  ctx          ctx.rest, ctx.onEvent, ctx.onDispose, ctx.pet with say and visible
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

FILES = {
    "events": "tui_gateway/contracts/events.py",
    "aux": "agent/auxiliary_client.py",
    "pricing": "agent/usage_pricing.py",
    "notify": "apps/desktop/src/store/notifications.ts",
    "sdk": "apps/desktop/src/sdk/index.ts",
    "ctx": "apps/desktop/src/contrib/plugin.ts",
}

SEAMS: dict[str, list[tuple[str, str]]] = {
    "frame": [("events", r'event\("message\.complete", MessageCompletePayload'),
              ("events", r"^\s+response_reused: bool \| None"),
              ("events", r'^\s+complete = "complete"')],
    "llm": [("aux", r"^def call_llm\(\s*task: str \| None = None, \*, provider: str \| None = None, model: str \| None = None"),
            ("aux", r"^\s+api_key: str \| None = None, main_runtime: Optional\[dict\[str, Any\]\] = None, messages: list,"),
            ("aux", r"^\s+temperature: Optional\[float\] = None, max_tokens: int \| None = None,"),
            ("aux", r"^\s+timeout: float \| None = None"),
            ("aux", r"^def extract_content_or_reasoning\(response")],
    "usage": [("pricing", r'^_CHAT_USAGE_SHAPE = \(\s*\(\("prompt_tokens",\),.*\n\s*\(\("completion_tokens",\),'),
              ("pricing", r'^_ANTHROPIC_USAGE_SHAPE = \(\s*\(\("input_tokens",\),\), \(\("output_tokens",\),\)'),
              ("pricing", r"^def normalize_usage\(")],
    "pricing": [("pricing", r"^def estimate_usage_cost\("),
                ("pricing", r'^CostStatus = Literal\["actual", "estimated", "included", "unknown"\]')],
    "notify": [("notify", r"if \(kind === 'error' \|\| kind === 'warning'\) \{\s*return 0")],
    "host": [("sdk", r"^\s+notify,$"),
             ("sdk", r"^\s+openSession: async \(storedSessionId: string"),
             ("sdk", r"^\s+focusedSessionId: readonlyAtom"),
             ("sdk", r"^\s+focusedStoredSessionId: readonlyAtom")],
    "ctx": [("ctx", r"^\s+rest: <T>\(path: string, opts\?: PluginRestOptions\) => Promise<T>$"),
            ("ctx", r"^\s+onEvent: \(type: string, listener: GatewayEventListener\) => \(\) => void$"),
            ("ctx", r"^\s+onDispose: \(fn: \(\) => void\) => void$"),
            ("ctx", r"^\s+pet: PluginPet$"),
            ("ctx", r"^\s+say: \(text: string, options\?: PetSayOptions\) => \(\) => void$"),
            ("ctx", r"^\s+visible: ReadableAtom<boolean>$")],
}


def default_core() -> Path:
    if os.environ.get("HERMES_CORE"):
        return Path(os.environ["HERMES_CORE"])
    base = Path(os.environ["HERMES_HOME"]) if os.environ.get("HERMES_HOME") else (
        Path(os.environ["LOCALAPPDATA"]) / "hermes" if os.environ.get("LOCALAPPDATA") else Path.home() / ".hermes")
    return base / "hermes-agent"


def run(core: Path) -> list[str]:
    texts, broken = {}, []
    for key, rel in FILES.items():
        path = core / rel
        if not path.exists():
            broken.append(f"missing file {rel}")
            continue
        texts[key] = path.read_text(encoding="utf-8")
    for seam, rules in SEAMS.items():
        for key, pattern in rules:
            if key in texts and not re.search(pattern, texts[key], re.M):
                broken.append(f"{seam}: {FILES[key]} no longer matches /{pattern[:70]}/")
    return broken


def selftest(core: Path) -> int:
    """Break each seam's first rule in a copy and require that seam to fail."""
    misses = 0
    for seam, rules in SEAMS.items():
        key, pattern = rules[0]
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp)
            for rel in FILES.values():
                (copy / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(core / rel, copy / rel)
            target = copy / FILES[key]
            text = target.read_text(encoding="utf-8")
            broken, n = re.subn(pattern, "/* removed */", text, count=1, flags=re.M)
            target.write_text(broken, encoding="utf-8")
            caught = n == 1 and any(b.startswith(f"{seam}:") for b in run(copy))
        print(f"{'PASS' if caught else 'FAIL'}  selftest: breaking {seam} is caught")
        misses += 0 if caught else 1
    return misses


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--core", type=Path, default=default_core())
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        misses = selftest(args.core)
        print("selftest: all seams fail when broken" if not misses else f"selftest: {misses} seam(s) not caught")
        return 1 if misses else 0
    broken = run(args.core)
    for b in broken:
        print(f"BROKEN  {b}")
    print(f"core contract: {'holds' if not broken else f'{len(broken)} broken'} ({args.core})")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
