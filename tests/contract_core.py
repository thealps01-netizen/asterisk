"""Asterisk — the seams the plugin uses in the Hermes core still exist and still mean the same.

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
  receipt      message.complete carries persisted_turn (PersistedTurn: row_ids, complete, user_row_id,
               final_assistant_row_id), and prompt_turn fills it with the committed rows of the turn
  store        hermes_state.SessionDB(db_path, read_only), close(), resolve_session_id,
               resolve_resume_session_id and get_messages(..., limit, latest, include_ancestors)
  redact       agent.redact.redact_sensitive_text(text, *, force, ..., redact_url_credentials)
  areas        COMPOSER_AREAS.top is 'composer.top', the composer renders that slot, and a slot mounts
               a contribution's render as a component
  rowslot      SESSION_ROW_AREAS.trailing is 'sessionRow.trailing' with data.render({ sessionId }),
               called per sidebar row with the row's stored (lineage-root) id
  sdkui        the SDK exports COMPOSER_AREAS, SESSION_ROW_AREAS, usePluginI18n, useValue (nanostores'
               useStore) and atom; ctx.register(contribution) returns its disposer
  title        SessionDB has get_session_title(session_id) (SessionTitlesMixin)
  install      `hermes plugins install` and the app's install name the folder after the manifest's name
               (plugin_name = manifest.get("name") or ...): plugin.yaml `asterisk` installs plugins/asterisk
  route        the backend mounts at /api/plugins/<manifest.json name>, and only for a user plugin whose
               name is in plugins.enabled
  rest         the desktop's ctx.rest reaches /api/plugins/<plugin.js id><path>: the three names must agree
  desktophalf  the desktop half is a copy of plugins/<folder>/desktop named after the folder, pruned when
               its package's plugin.js is gone (how an uninstall removes the 2.x half)
  remove       uninstall moves the package tree out of plugins/ (os.replace), its own folder only
  shim         the SDK shim exports only the names it has (a namespace import always links)
  installui    Capabilities -> Plugins offers "Install from Git" and "Uninstall" (the README's steps)
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
    "turn": "tui_gateway/prompt_turn.py",
    "state": "hermes_state.py",
    "messages": "hermes_state_messages.py",
    "sessions": "hermes_state_sessions.py",
    "redact": "agent/redact.py",
    "composer_contrib": "apps/desktop/src/app/chat/composer/contrib.ts",
    "composer": "apps/desktop/src/app/chat/composer/index.tsx",
    "slot": "apps/desktop/src/contrib/react/slot.tsx",
    "rowslots": "apps/desktop/src/lib/session-row-slots.ts",
    "rowslot_view": "apps/desktop/src/app/chat/sidebar/session-row-slots.tsx",
    "row": "apps/desktop/src/app/chat/sidebar/session-row.tsx",
    "titles": "hermes_state_titles.py",
    "install": "hermes_cli/plugins_cmd_install.py",
    "dashboard": "hermes_cli/web_server_dashboard.py",
    "api_plugins": "apps/desktop/src/api/plugins.ts",
    "desktop_root": "apps/desktop/electron/desktop-plugins-root.ts",
    "remove": "hermes_cli/plugins_cmd_remove.py",
    "runtime": "apps/desktop/src/sdk/runtime.ts",
    "plugins_tab": "apps/desktop/src/app/capabilities/plugins/plugins-tab.tsx",
    "en": "apps/desktop/src/i18n/en.ts",
}


def lit(text: str) -> str:
    """A seam that is one exact piece of source."""
    return re.escape(text)


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
    "receipt": [("events", r"^class PersistedTurn\(Payload\):"),
                ("events", r"^\s+row_ids: list\[int\]$"),
                ("events", r"^\s+complete: bool$"),
                ("events", r"^\s+user_row_id: int \| None = None$"),
                ("events", r"^\s+final_assistant_row_id: int \| None = None$"),
                ("events", r"^\s+persisted_turn: PersistedTurn \| None = None$"),
                ("turn", r'^\s+payload\["persisted_turn"\] = receipt$'),
                ("turn", r'^\s+receipt\["final_assistant_row_id"\] = final_id$')],
    "store": [("state", r"^\s+def __init__\(self, db_path: Path \| None = None, read_only: bool = False\):$"),
              ("state", r"^\s+def close\(self\):$"),
              ("messages", r"^\s+def get_messages\(self, session_id: str, include_inactive: bool = False, include_compacted: bool = False,\n"
                           r"\s+limit: Optional\[int\] = None, offset: int = 0, latest: bool = False,\n"
                           r"\s+after_id: Optional\[int\] = None, include_ancestors: bool = False\) -> list\[dict\[str, Any\]\]:"),
              ("messages", r"^\s+def resolve_resume_session_id\(self, session_id: str\) -> str:$"),
              ("sessions", r"^\s+def resolve_session_id\(self, session_id_or_prefix: str\) -> Optional\[str\]:$")],
    "redact": [("redact", r"^def redact_sensitive_text\(text: str, \*, force: bool = False,"),
               ("redact", r"^\s+redact_url_credentials: bool = False\) -> str:$")],
    "areas": [("composer_contrib", r"^\s+top: 'composer\.top',?$"),
              ("composer", r"<ContribSlot area=\{COMPOSER_AREAS\.top\} />"),
              ("slot", r"\{c\.render && <ContribRender render=\{c\.render\} />\}")],
    "rowslot": [("rowslots", r"^\s+trailing: 'sessionRow\.trailing'"),
                ("rowslots", r"^\s+render: \(props: SessionRowSlotProps\) => ReactNode$"),
                ("rowslot_view", r"render\(\{ sessionId \}\)"),
                ("row", r"<SessionRowSlot area=\{SESSION_ROW_AREAS\.trailing\} sessionId=\{sessionPinId\(session\)\} />")],
    "sdkui": [("sdk", r"^\s+COMPOSER_AREAS,$"),
              ("sdk", r"^export \{ SESSION_ROW_AREAS\b"),
              ("sdk", r"^\s+usePluginI18n$"),
              ("sdk", r"^export \{ useStore as useValue \} from '@nanostores/react'$"),
              ("sdk", r"^export \{ atom, computed \} from 'nanostores'$"),
              ("ctx", r"^\s+register: \(c: PluginContribution\) => \(\) => void$")],
    "title": [("titles", r"^\s+def get_session_title\(self, session_id: str\) -> Optional\[str\]:$"),
              ("state", r"^class SessionDB\((?:[^)]|\n)*\bSessionTitlesMixin\b")],
    "install": [("install", lit('plugin_name = manifest.get("name") or ('))],
    "route": [("dashboard", lit('name = data.get("name", child.name)')),
              ("dashboard", lit("prefix=f\"/api/plugins/{plugin['name']}\"")),
              ("dashboard", lit('if source == "user" and plugin_name not in enabled_set:'))],
    "rest": [("api_plugins", lit("path: `/api/plugins/${pluginId}${suffix}`")),
             ("ctx", lit("rest: <T>(path: string, opts?: PluginRestOptions) => pluginRest<T>(pluginId, path, opts),"))],
    "desktophalf": [("desktop_root", lit("const sourceDir = path.join(packageDir, 'desktop')")),
                    ("desktop_root", lit("const target = path.join(appRoot, packageName)")),
                    ("desktop_root", lit("result = await materializeDesktopHalf(path.join(pluginsRoot, name), appRoot, name)")),
                    ("desktop_root", lit("if (marker && (await sourceGone(name, path.join(marker.source, 'plugin.js')))) {"))],
    "remove": [("remove", lit("os.replace(target, backup)"))],
    "shim": [("runtime", lit("export default m.default ?? m;")),
             ("runtime", lit("export const { ${names.join(', ')} } = m;"))],
    "installui": [("plugins_tab", lit("openPluginInstallRequest({ profile: scope, repo: '' })")),
                  ("en", lit("installFromGit: 'Install from Git',")),
                  ("en", lit("uninstall: 'Uninstall',")),
                  ("en", lit("tabPlugins: 'Plugins',"))],
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
