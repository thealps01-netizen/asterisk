"""Asterisk — the backend run against a REAL Hermes core (no stand-ins), with a fake model server.

Run: python core_smoke.py --core <hermes-agent checkout>              (exit 0 = the backend works on that core)
     python core_smoke.py --core <hermes-agent checkout> --selftest   (exit 0 = a core whose SessionDB no
                                                                       longer takes read_only fails it)

The interpreter must be able to import the core (its dependencies installed). check_api.py replaces the
core with fakes and contract_core.py reads the core's source; this one executes it. The backend runs
inside an already started Hermes process, so this imports the core's modules directly and never
hermes_bootstrap (which prepares a runtime per data root and relaunches the script for a new
HERMES_HOME). Everything the backend touches is the core's own code: the profile's config.yaml,
SessionDB (a real store in a temporary HERMES_HOME), user_originated_turn_view,
tool_may_have_side_effect, redaction,
_resolve_task_provider_model, call_llm and its OpenAI-compatible client, the usage and pricing code,
plugin_data_dir and the PersistedTurn receipt model. Only the model is fake: a local HTTP server that
answers chat completions, so no request leaves the machine and nothing is paid.

Steps: no model chosen -> 409; a turn with a side-effect tool -> one request to the fake server and one
point back, a ledger line with model and tokens, the note stored; dismiss writes its signal and drops the
note; report counts them; status says ready (the receipt seam is there).
"""
from __future__ import annotations

import argparse
import importlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POINT = {"kind": "result", "by": "assistant", "headline": "The file was not checked",
         "text": "The reply says the file is valid, but no tool read it after the write.", "language": "English"}
failures: list[str] = []


def check(ok: bool, label: str) -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}")
    if not ok:
        failures.append(label)


class FakeModel(BaseHTTPRequestHandler):
    requests: list[dict] = []

    def do_POST(self):  # noqa: N802 — http.server's name
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        FakeModel.requests.append({"path": self.path, "body": body, "auth": self.headers.get("Authorization")})
        answer = {"id": "chatcmpl-smoke", "object": "chat.completion", "created": 0, "model": body.get("model"),
                  "choices": [{"index": 0, "finish_reason": "stop",
                               "message": {"role": "assistant", "content": json.dumps({"points": [POINT]})}}],
                  "usage": {"prompt_tokens": 1200, "completion_tokens": 80, "total_tokens": 1280}}
        data = json.dumps(answer).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def start_core(core: Path) -> None:
    sys.path.insert(0, str(core))
    importlib.import_module("hermes_constants")


def load_backend():
    spec = importlib.util.spec_from_file_location("asterisk_smoke_backend", ROOT / "dashboard" / "plugin_api.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_config(home: Path, port: int) -> None:
    (home / "config.yaml").write_text(
        "auxiliary:\n  asterisk:\n    provider: custom\n    model: smoke-model\n"
        f"    base_url: http://127.0.0.1:{port}/v1\n    api_key: smoke-key\n", encoding="utf-8")


def seed_turn(session_id: str) -> dict:
    from hermes_state import SessionDB
    db = SessionDB()
    try:
        db.create_session(session_id, "cli")
        db.append_message(session_id, "user", "Earlier: keep the config in YAML.")
        db.append_message(session_id, "assistant", "Noted.")
        user = db.append_message(session_id, "user", "Write settings.yaml and tell me it is valid.")
        call = db.append_message(session_id, "assistant", "", tool_calls=[
            {"id": "call_1", "type": "function", "function": {"name": "write_file", "arguments": "{\"path\": \"settings.yaml\"}"}}])
        result = db.append_message(session_id, "tool", "{\"ok\": true}", tool_name="write_file", tool_call_id="call_1")
        final = db.append_message(session_id, "assistant", "Done: settings.yaml is written and valid.")
    finally:
        db.close()
    from tui_gateway.contracts.events import PersistedTurn
    receipt = PersistedTurn(row_ids=[user, call, result, final], complete=True, user_row_id=user,
                            final_assistant_row_id=final)
    return receipt.model_dump() if hasattr(receipt, "model_dump") else dict(receipt)


def break_store() -> None:
    import hermes_state
    real = hermes_state.SessionDB.__init__

    def without_read_only(self, db_path=None, **kwargs):
        if "read_only" in kwargs:
            raise TypeError("SessionDB.__init__() got an unexpected keyword argument 'read_only'")
        real(self, db_path)

    hermes_state.SessionDB.__init__ = without_read_only


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--core", type=Path, required=True)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)
    home = Path(tempfile.mkdtemp(prefix="asterisk-smoke-"))
    os.environ["HERMES_HOME"] = str(home)
    server = HTTPServer(("127.0.0.1", 0), FakeModel)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        start_core(args.core.resolve())
        if args.selftest:
            break_store()
        api = load_backend()
        from fastapi import HTTPException

        session_id = "smoke-session"
        turn = seed_turn(session_id)
        check(set(turn) >= {"row_ids", "complete", "user_row_id", "final_assistant_row_id"},
              f"the core's PersistedTurn carries the receipt fields ({sorted(turn)})")

        try:
            api.check(session_id, turn)
            check(False, "no model chosen: 409")
        except HTTPException as exc:
            check(exc.status_code == 409 and exc.detail == "no model chosen",
                  f"no model chosen: the core's task route says auto, the backend answers 409 ({exc.status_code} {exc.detail})")
        check(not FakeModel.requests, "no model chosen: nothing is sent")

        write_config(home, server.server_port)
        result = api.check(session_id, turn)
        check(len(FakeModel.requests) == 1, f"one request reaches the model server ({len(FakeModel.requests)})")
        sent = FakeModel.requests[0] if FakeModel.requests else {"body": {}, "path": "", "auth": ""}
        check(sent["path"].endswith("/chat/completions") and sent["body"].get("model") == "smoke-model"
              and sent["auth"] == "Bearer smoke-key",
              f"call_llm routes the task to the configured endpoint and model ({sent['path']}, {sent['body'].get('model')})")
        prompt = json.dumps(sent["body"].get("messages") or [])
        check("settings.yaml is written and valid" in prompt and "write_file" in prompt
              and "keep the config in YAML" in prompt,
              "the turn read from the real store (reply, tool call, earlier user message) is in the prompt")
        check([p["kind"] for p in result.get("points") or []] == ["result"] and result.get("model") == "smoke-model",
              f"the point comes back, named with the model that answered ({result.get('model')})")

        ledger = home / "state" / "asterisk" / "ledger.jsonl"
        lines = [json.loads(l) for l in ledger.read_text(encoding="utf-8").splitlines() if l.strip()] if ledger.exists() else []
        last = lines[-1] if lines else {}
        check(last.get("kinds") == ["result"] and last.get("input_tokens") == 1200 and last.get("output_tokens") == 80
              and last.get("model") == "smoke-model",
              f"the ledger line has the kind, the model and the core's usage reading ({last.get('input_tokens')}/{last.get('output_tokens')})")
        notes_file = home / "plugin-data" / "asterisk" / "notes.json"
        check(notes_file.is_file() and len(api.notes().get("notes") or []) == 1,
              "the note is stored where the core's plugin_data_dir points")

        api.dismiss(result["at"], "asked")
        check(len(api.notes().get("notes") or []) == 0, "dismiss drops the stored note")
        report = api.report()
        totals = report.get("totals") or {}
        check(totals.get("checks") == 1 and totals.get("notes") == 1 and totals.get("asked") == 1,
              f"the report counts the check, the note and its asked signal ({totals})")
        check(api.status(True).get("ready") is True, "status: ready (the core's receipt seam is there)")
    except Exception as exc:  # noqa: BLE001 — any crash on a real core is the finding
        check(False, f"the backend runs on this core without an exception ({type(exc).__name__}: {exc})")
    finally:
        server.shutdown()
        shutil.rmtree(home, ignore_errors=True)
    if args.selftest:
        print(f"core smoke selftest: {'a broken store is caught' if failures else 'a broken store PASSES (the smoke cannot fail)'}")
        return 0 if failures else 1
    print(f"core smoke: {'works' if not failures else f'{len(failures)} failed'} ({args.core})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
