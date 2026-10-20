"""Asterisk — static rules over the shipped files.

Run: python audit_static.py [--root <repo copy>]      (exit 0 = clean)

Rules:
  loader      every import specifier the desktop loader would scan is `@hermes/plugin-sdk` or
              `react...` (the loader rejects the whole plugin otherwise, and the plugin simply never
              appears)
  surface     the desktop half registers exactly two contributions — `area: COMPOSER_AREAS.top`
              and `area: SESSION_ROW_AREAS.trailing`, each once — plus exactly one settings page
              (`ctx.registerSettingsPage?.(`, feature-detected), and no pane, route page or nav row;
              it reaches no network or storage of its own: its only doors are ctx.rest (its own
              backend), host.notify, host.openSession and host.composer.insertText (never submit,
              setDraft or getDraft: it puts text into an input and never sends)
  container   the settings page sizes by the pane, not the window: desktop/plugin.js has no @media
              width query and has `container-type:inline-size` and an `@container` rule
  theme       every var(--name) in desktop/plugin.js is a token the app declares (`--name:` in the
              core's apps/desktop/src/styles.css; core from --core, HERMES_CORE or
              <HERMES_HOME>/hermes-agent). A missing styles.css is a problem, never a skip.
  versions    plugin.yaml, dashboard/manifest.json and the top CHANGELOG heading name one version
  name        plugin.yaml `name`, manifest.json `name`, PLUGIN_ID in plugin_api.py and `const ID` in
              plugin.js are all `asterisk` (the install folder, the route and the desktop's REST path
              are each derived from one of them), call_llm is called with task=PLUGIN_ID, and
              __init__.py registers that auxiliary task (`register_auxiliary_task("asterisk"`)
  model       the model is the user's choice: plugin_api.py assigns no MODEL / PROVIDER and passes no
              provider= / model= inside its call_llm( call, plugin.js never says Opus, and the notes
              name `claude-opus-5-5` (the only model the cost was measured on); the desktop half has
              no length floor (no MIN_CHARS, no text.length test: the backend alone decides) and the
              notes state the backend's floor
  caps        the notes state the total and the per-tool-result caps (MAX_TURN_CHARS,
              MAX_TOOL_RESULT_CHARS) and the earlier-message caps (MAX_EARLIER_MESSAGES,
              MAX_EARLIER_MESSAGE_CHARS, MAX_EARLIER_CHARS) as the backend has them
  delegate    plugin_api.py asks the core which tools may change something
              (tool_may_have_side_effect) and which user rows are the user's own
              (user_originated_turn_view), each imported once, and holds no copy of either rule (no
              quoted read-only tool name, "display_kind" or "steer")
  eval        CI never runs the offline evaluation (it spends money): ci.yml names neither eval/
              nor compare_checkers
  sparse      every core file tests/contract_core.py reads (FILES) is in ci.yml's sparse checkout of
              the core; a local run reads the full core, so a missing path only fails in CI
  versions    the minimum Hermes version README.md states is a core in ci.yml's core-versions matrix,
              and that job runs core_smoke.py and its selftest (a stated minimum is a tested one)
  notes       the development-phase note store: plugin_api.py takes plugin_data_dir from the host once,
              names NOTES_FILE = "notes.json" and a NOTES_MAX, keeps the ledger in state/asterisk/, and
              the notes (plugin-data/asterisk/notes.json, "at most <NOTES_MAX> notes", "development
              phase") and README.md ("development phase") say the note text is kept on disk
  installed   the desktop copy the app loads equals desktop/plugin.js (only when it exists here)
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# `from` / `import` as keywords only: `t('asterisk.from', …)` or an `asterisk-from` class is a string, not an import
# (the desktop loader itself skips strings and comments).
LOADER = re.compile(r"""(?<![\w.$-])(from\s*|import\s*\(\s*|import\s+)(['"])([^'"]+)\2""")
FORBIDDEN = (r"\bfetch\(", r"XMLHttpRequest", r"localStorage", r"ctx\.storage", r"\bpanes\b", r"PANES_AREA",
             r"revealPane", r"window\.hermesDesktop", r"\.submit\(", r"setDraft", r"getDraft")
AREAS = ("COMPOSER_AREAS.top", "SESSION_ROW_AREAS.trailing")
NAME = "asterisk"


def hermes_home() -> Path:
    if os.environ.get("HERMES_HOME"):
        return Path(os.environ["HERMES_HOME"])
    if os.environ.get("LOCALAPPDATA"):
        return Path(os.environ["LOCALAPPDATA"]) / "hermes"
    return Path.home() / ".hermes"


def default_core() -> Path:
    """The same lookup as contract_core.default_core."""
    return Path(os.environ["HERMES_CORE"]) if os.environ.get("HERMES_CORE") else hermes_home() / "hermes-agent"


def audit(root: Path, installed: Path | None, core: Path) -> list[str]:
    problems: list[str] = []
    js = (root / "desktop" / "plugin.js").read_text(encoding="utf-8")
    api = (root / "dashboard" / "plugin_api.py").read_text(encoding="utf-8")

    for m in LOADER.finditer(js):
        if m.group(3) != "@hermes/plugin-sdk" and not m.group(3).startswith("react"):
            problems.append(f"loader: specifier {m.group(3)!r} — the loader would reject the whole plugin")
    for pattern in FORBIDDEN:
        if re.search(pattern, js):
            problems.append(f"surface: {pattern} in desktop/plugin.js — the plugin's only doors are ctx.rest, host.notify, host.openSession and host.composer.insertText")
    areas = re.findall(r"\barea:\s*([^,}\s]+)", js)
    if sorted(areas) != sorted(AREAS) or len(re.findall(r"\bctx\.register\(", js)) != 2:
        problems.append(f"surface: the desktop half must register exactly {' and '.join(AREAS)}, each once (found {areas})")
    pages = js.count("ctx.registerSettingsPage?.(")
    if pages != 1:
        problems.append(f"surface: the desktop half must register exactly one settings page with ctx.registerSettingsPage?.( (found {pages})")
    if re.search(r"@media[^{]*(?:min|max)-width", js) or "container-type:inline-size" not in js or "@container" not in js:
        problems.append("container: desktop/plugin.js must size by the pane (@container), not the window (@media)")

    styles = core / "apps" / "desktop" / "src" / "styles.css"
    if not styles.is_file():
        problems.append(f"theme: {styles} is missing — the theme tokens cannot be checked (point --core or HERMES_CORE at a core checkout)")
    else:
        declared = set(re.findall(r"(--[\w-]+)\s*:", styles.read_text(encoding="utf-8")))
        for name in sorted(set(re.findall(r"var\(\s*(--[\w-]+)", js)) - declared):
            problems.append(f"theme: var({name}) in desktop/plugin.js is not a token the app declares in styles.css")

    yaml_text = (root / "plugin.yaml").read_text(encoding="utf-8")
    yaml_version = re.search(r"^version:\s*(\S+)", yaml_text, re.M)
    manifest = json.loads((root / "dashboard" / "manifest.json").read_text(encoding="utf-8"))
    heading = re.search(r"^## (\S+) ", (root / "CHANGELOG.md").read_text(encoding="utf-8"), re.M)
    versions = {yaml_version.group(1) if yaml_version else None, manifest.get("version"), heading.group(1) if heading else None}
    if len(versions) != 1 or None in versions:
        problems.append(f"versions: plugin.yaml / manifest / CHANGELOG disagree {sorted(map(str, versions))}")

    yaml_name = re.search(r"^name:\s*(\S+)$", yaml_text, re.M)
    plugin_id = re.search(r'^PLUGIN_ID = "([^"]+)"$', api, re.M)
    js_id = re.search(r"^const ID = '([^']+)'$", js, re.M)
    names = {"plugin.yaml": yaml_name.group(1) if yaml_name else None, "manifest.json": manifest.get("name"),
             "PLUGIN_ID": plugin_id.group(1) if plugin_id else None, "const ID": js_id.group(1) if js_id else None}
    wrong = {k: v for k, v in names.items() if v != NAME}
    if wrong:
        problems.append(f"name: every name must be {NAME!r} (folder, route and REST path follow them) — {wrong}")
    if "call_llm(task=PLUGIN_ID," not in api:
        problems.append("name: call_llm is not called with task=PLUGIN_ID")
    init = (root / "__init__.py").read_text(encoding="utf-8")
    if 'register_auxiliary_task("asterisk"' not in init:
        problems.append('name: __init__.py does not register the auxiliary task "asterisk" (its model row in Settings → Models)')

    notes = (root / "Docs" / "asterisk-notes.md").read_text(encoding="utf-8")
    floor = re.search(r"^MIN_CHARS = (\d+)$", api, re.M)
    if re.search(r"^(?:MODEL|PROVIDER)\s*=", api, re.M):
        problems.append("model: plugin_api.py names a MODEL or PROVIDER again — the model is the user's choice (Settings → Models)")
    call = re.search(r"(?<![\w.])call_llm\((.*?)\)", api, re.S)
    if not call or re.search(r"\b(?:provider|model)\s*=", call.group(1)):
        problems.append("model: the call_llm( call passes provider= or model= — the task's Settings row must decide the route")
    if "Opus" in js:
        problems.append("model: desktop/plugin.js says Opus — the strip names the model that answered")
    if "`claude-opus-5-5`" not in notes:
        problems.append("model: the notes do not name `claude-opus-5-5`, the only model the cost was measured on")
    if "MIN_CHARS" in js or re.search(r"\btext\.length\s*>=?\s*\d", js):
        problems.append("model: the desktop half filters on reply length again — the backend alone decides which turns are checked")
    if not floor:
        problems.append("model: plugin_api.py has no MIN_CHARS — the backend's length floor is gone")
    elif f"{int(floor.group(1)):,}" not in notes:
        problems.append("model: the notes do not state the length floor the code uses")

    for name in ("MAX_TURN_CHARS", "MAX_TOOL_RESULT_CHARS"):
        cap = re.search(rf"^{name} = (\d+)$", api, re.M)
        if not cap or not re.search(rf"(?<![\d,]){int(cap.group(1)):,}(?![\d,])", notes):
            problems.append(f"caps: the notes do not state {name} as the backend has it")
    earlier = {n: re.search(rf"^{n} = (\d+)$", api, re.M) for n in ("MAX_EARLIER_MESSAGES", "MAX_EARLIER_MESSAGE_CHARS", "MAX_EARLIER_CHARS")}
    if not all(earlier.values()):
        problems.append("caps: plugin_api.py lacks MAX_EARLIER_MESSAGES, MAX_EARLIER_MESSAGE_CHARS or MAX_EARLIER_CHARS")
    else:
        n, each, total = (int(m.group(1)) for m in earlier.values())
        if f"the last {n} user messages before the turn, each at most {each:,} characters, at most {total:,} together" not in notes:
            problems.append("caps: the notes do not state the earlier-message caps as the backend has them")

    for line in ("from agent.tool_result_classification import tool_may_have_side_effect",
                 "from agent.context_compressor import user_originated_turn_view"):
        if api.count(line) != 1:
            problems.append(f"delegate: plugin_api.py must ask the core once ({line!r}, found {api.count(line)})")
    for copied in ('"read_file"', '"search_files"', '"web_search"', '"web_extract"', '"session_search"', '"skill_view"',
                   '"skills_list"', '"vision_analyze"', '"display_kind"', '"steer"'):
        if copied in api:
            problems.append(f"delegate: plugin_api.py holds {copied} — ask the core (tool_may_have_side_effect, "
                            "user_originated_turn_view) instead of copying its rule")

    ci = (root / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    if "eval/" in ci or "compare_checkers" in ci:
        problems.append("eval: ci.yml mentions the offline evaluation — it spends money and never runs in CI")
    spec = importlib.util.spec_from_file_location("contract_core_files", root / "tests" / "contract_core.py")
    contract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(contract)
    sparse = re.search(r"sparse-checkout set(.*?)\n\s*for i in", ci, re.S)
    listed = set(re.findall(r"(?:^|\s)/([\w./-]+)", sparse.group(1))) if sparse else set()
    for rel in sorted(set(contract.all_paths()) - listed):
        problems.append(f"sparse: contract_core.py reads {rel}, but ci.yml's sparse checkout of the core does not fetch it")
    stated = re.search(r"Needs Hermes (v\d+\.\d+\.\d+) or later", (root / "README.md").read_text(encoding="utf-8"))
    if not stated:
        problems.append("versions: README.md does not state the minimum Hermes version (\"Needs Hermes vX.Y.Z or later\")")
    elif f"name: {stated.group(1)}, sha: " not in ci:
        problems.append(f"versions: README.md's minimum {stated.group(1)} is not a core in ci.yml's core-versions matrix")
    if 'python core_smoke.py --core "$CORE" && python core_smoke.py --core "$CORE" --selftest' not in ci:
        problems.append("versions: ci.yml does not run core_smoke.py (and its selftest) on the real cores")

    storage_import = "from plugins.plugin_storage import plugin_data_dir"
    if api.count(storage_import) != 1:
        problems.append(f"notes: plugin_api.py must take the note storage from the host once ({storage_import!r}, found {api.count(storage_import)})")
    if not re.search(r'^NOTES_FILE = "notes.json"$', api, re.M):
        problems.append('notes: plugin_api.py has no NOTES_FILE = "notes.json" — the docs name that file')
    if 'return _home() / "state" / PLUGIN_ID / "ledger.jsonl"' not in api:
        problems.append("notes: the ledger left state/asterisk/ledger.jsonl — only the notes live in plugin-data")
    notes_max = re.search(r"^NOTES_MAX = (\d+)$", api, re.M)
    if not notes_max:
        problems.append("notes: plugin_api.py has no NOTES_MAX — the stored notes have no cap")
    elif f"at most {int(notes_max.group(1))} notes" not in notes:
        problems.append("notes: the notes do not state NOTES_MAX as the backend has it")
    for needle in ("plugin-data/asterisk/notes.json", "development phase"):
        if needle not in notes:
            problems.append(f"notes: Docs/asterisk-notes.md does not say {needle!r} — the stored note text must be documented")
    if "development phase" not in (root / "README.md").read_text(encoding="utf-8"):
        problems.append("notes: README.md does not say the note text is kept on disk for the development phase")

    if installed and installed.exists() and installed.read_bytes() != (root / "desktop" / "plugin.js").read_bytes():
        problems.append(f"installed: {installed} differs from desktop/plugin.js — reinstall, the app loads that copy")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=HERE.parent)
    parser.add_argument("--no-installed", action="store_true", help="skip the installed-copy rule (canary copies)")
    parser.add_argument("--core", type=Path, default=default_core(), help="the Hermes core checkout (for the theme rule)")
    args = parser.parse_args()
    installed = None if args.no_installed else hermes_home() / "desktop-plugins" / "asterisk" / "plugin.js"
    problems = audit(args.root.resolve(), installed, args.core)
    for p in problems:
        print(f"PROBLEM  {p}")
    print(f"static audit: {'clean' if not problems else f'{len(problems)} problem(s)'}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
