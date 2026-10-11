"""You Should Know — static rules over the shipped files.

Run: python audit_static.py [--root <repo copy>]      (exit 0 = clean)

Rules:
  loader      every import specifier the desktop loader would scan is `@hermes/plugin-sdk` (the
              loader rejects the whole plugin otherwise, and the plugin simply never appears)
  surface     the desktop half registers no page, pane or nav row, and reaches no network or
              storage of its own: its only doors are ctx.rest (its own backend) and host.notify
  versions    plugin.yaml, dashboard/manifest.json and the top CHANGELOG heading name one version
  model       the model and the price floor the notes describe are the ones the backend uses
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
LOADER = re.compile(r"""(from\s*|import\s*\(\s*|import\s+)(['"])([^'"]+)\2""")
FORBIDDEN = (r"\bfetch\(", r"XMLHttpRequest", r"localStorage", r"ctx\.storage", r"ctx\.register\(", r"\bpanes\b",
             r"window\.hermesDesktop")


def hermes_home() -> Path:
    if os.environ.get("HERMES_HOME"):
        return Path(os.environ["HERMES_HOME"])
    if os.environ.get("LOCALAPPDATA"):
        return Path(os.environ["LOCALAPPDATA"]) / "hermes"
    return Path.home() / ".hermes"


def audit(root: Path, installed: Path | None) -> list[str]:
    problems: list[str] = []
    js = (root / "desktop" / "plugin.js").read_text(encoding="utf-8")
    api = (root / "dashboard" / "plugin_api.py").read_text(encoding="utf-8")

    for m in LOADER.finditer(js):
        if m.group(3) != "@hermes/plugin-sdk" and not m.group(3).startswith("react"):
            problems.append(f"loader: specifier {m.group(3)!r} — the loader would reject the whole plugin")
    for pattern in FORBIDDEN:
        if re.search(pattern, js):
            problems.append(f"surface: {pattern} in desktop/plugin.js — the plugin's only doors are ctx.rest and host.notify")

    yaml_version = re.search(r"^version:\s*(\S+)", (root / "plugin.yaml").read_text(encoding="utf-8"), re.M)
    manifest = json.loads((root / "dashboard" / "manifest.json").read_text(encoding="utf-8"))
    heading = re.search(r"^## (\S+) ", (root / "CHANGELOG.md").read_text(encoding="utf-8"), re.M)
    versions = {yaml_version.group(1) if yaml_version else None, manifest.get("version"), heading.group(1) if heading else None}
    if len(versions) != 1 or None in versions:
        problems.append(f"versions: plugin.yaml / manifest / CHANGELOG disagree {sorted(map(str, versions))}")

    notes = (root / "Docs" / "you-should-know-notes.md").read_text(encoding="utf-8")
    model = re.search(r'^MODEL = "([^"]+)"', api, re.M)
    floor = re.search(r"^MIN_CHARS = (\d+)", api, re.M)
    js_floor = re.search(r"^export const MIN_CHARS = (\d+)", js, re.M)
    if not model or f"`{model.group(1)}`" not in notes:
        problems.append("model: the notes do not name the model the backend calls")
    if not floor or not js_floor or floor.group(1) != js_floor.group(1):
        problems.append("model: the backend and the desktop half disagree on the length floor")
    elif f"{int(floor.group(1)):,}" not in notes:
        problems.append("model: the notes do not state the length floor the code uses")

    if installed and installed.exists() and installed.read_bytes() != (root / "desktop" / "plugin.js").read_bytes():
        problems.append(f"installed: {installed} differs from desktop/plugin.js — reinstall, the app loads that copy")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=HERE.parent)
    parser.add_argument("--no-installed", action="store_true", help="skip the installed-copy rule (canary copies)")
    args = parser.parse_args()
    installed = None if args.no_installed else hermes_home() / "desktop-plugins" / "you-should-know" / "plugin.js"
    problems = audit(args.root.resolve(), installed)
    for p in problems:
        print(f"PROBLEM  {p}")
    print(f"static audit: {'clean' if not problems else f'{len(problems)} problem(s)'}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
