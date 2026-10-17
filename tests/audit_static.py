"""Asterisk — static rules over the shipped files.

Run: python audit_static.py [--root <repo copy>]      (exit 0 = clean)

Rules:
  loader      every import specifier the desktop loader would scan is `@hermes/plugin-sdk` or
              `react...` (the loader rejects the whole plugin otherwise, and the plugin simply never
              appears)
  surface     the desktop half registers exactly two contributions — `area: COMPOSER_AREAS.top`
              and `area: SESSION_ROW_AREAS.trailing`, each once — and no pane, page or nav row; it
              reaches no network or storage of its own: its only doors are ctx.rest (its own
              backend), host.notify and host.openSession
  theme       every var(--name) in desktop/plugin.js is a token the app declares (`--name:` in the
              core's apps/desktop/src/styles.css; core from --core, HERMES_CORE or
              <HERMES_HOME>/hermes-agent). A missing styles.css is a problem, never a skip.
  versions    plugin.yaml, dashboard/manifest.json and the top CHANGELOG heading name one version
  name        plugin.yaml `name`, manifest.json `name`, PLUGIN_ID in plugin_api.py and `const ID` in
              plugin.js are all `asterisk` (the install folder, the route and the desktop's REST path
              are each derived from one of them), and call_llm is called with task=PLUGIN_ID
  model       the model and the price floor the notes describe are the ones the backend uses
  caps        the notes state the total and the per-tool-result caps (MAX_TURN_CHARS,
              MAX_TOOL_RESULT_CHARS) as the backend has them
  eval        CI never runs the offline evaluation (it spends money): ci.yml names neither eval/
              nor compare_checkers
  installed   the desktop copy the app loads equals desktop/plugin.js (only when it exists here)
"""
from __future__ import annotations

import argparse
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
             r"registerSettingsPage", r"revealPane", r"window\.hermesDesktop")
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
            problems.append(f"surface: {pattern} in desktop/plugin.js — the plugin's only doors are ctx.rest, host.notify and host.openSession")
    areas = re.findall(r"\barea:\s*([^,}\s]+)", js)
    if sorted(areas) != sorted(AREAS) or len(re.findall(r"\bctx\.register\(", js)) != 2:
        problems.append(f"surface: the desktop half must register exactly {' and '.join(AREAS)}, each once (found {areas})")

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

    notes = (root / "Docs" / "asterisk-notes.md").read_text(encoding="utf-8")
    model = re.search(r'^MODEL = "([^"]+)"', api, re.M)
    floor = re.search(r"^MIN_CHARS = (\d+)", api, re.M)
    js_floor = re.search(r"^export const MIN_CHARS = (\d+)", js, re.M)
    if not model or f"`{model.group(1)}`" not in notes:
        problems.append("model: the notes do not name the model the backend calls")
    if not floor or not js_floor or floor.group(1) != js_floor.group(1):
        problems.append("model: the backend and the desktop half disagree on the length floor")
    elif f"{int(floor.group(1)):,}" not in notes:
        problems.append("model: the notes do not state the length floor the code uses")

    for name in ("MAX_TURN_CHARS", "MAX_TOOL_RESULT_CHARS"):
        cap = re.search(rf"^{name} = (\d+)$", api, re.M)
        if not cap or not re.search(rf"(?<![\d,]){int(cap.group(1)):,}(?![\d,])", notes):
            problems.append(f"caps: the notes do not state {name} as the backend has it")

    ci = (root / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    if "eval/" in ci or "compare_checkers" in ci:
        problems.append("eval: ci.yml mentions the offline evaluation — it spends money and never runs in CI")

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
