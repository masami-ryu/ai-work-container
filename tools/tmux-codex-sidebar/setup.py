#!/usr/bin/env python3
"""既存設定を保持し、バックアップを作ってサイドバーを導入する。"""

import argparse
import copy
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import re
import shlex
import sys
import tempfile
import tomllib

from sidebar import Tmux


TITLE_ITEMS = ["app-name", "thread-id", "status"]
TITLE_LINE = 'terminal_title = ["app-name", "thread-id", "status"]\n'
BEGIN = "# BEGIN tmux-codex-sidebar"
END = "# END tmux-codex-sidebar"


def codex_config(text):
    original = tomllib.loads(text)
    if original.get("tui", {}).get("terminal_title") == TITLE_ITEMS:
        return text
    lines = text.splitlines(keepends=True)
    section = next((i for i, line in enumerate(lines)
                    if re.match(r'''^\s*\[\s*(?:tui|"tui"|'tui')\s*\]\s*(?:#.*)?$''', line)), None)
    if section is None:
        result = text.rstrip() + "\n\n[tui]\n" + TITLE_LINE
    else:
        end = next((i for i in range(section + 1, len(lines)) if re.match(r"^\s*\[", lines[i])), len(lines))
        entry = next((i for i in range(section + 1, end)
                      if re.match(r'''^\s*(?:terminal_title|"terminal_title"|'terminal_title')\s*=''', lines[i])), None)
        if entry is None:
            lines.insert(section + 1, TITLE_LINE)
        else:
            last = entry + 1
            while last <= end:
                try:
                    tomllib.loads("".join(lines[entry:last]))
                    break
                except tomllib.TOMLDecodeError:
                    last += 1
            lines[entry:last] = [TITLE_LINE]
        result = "".join(lines)
    expected = copy.deepcopy(original)
    expected.setdefault("tui", {})["terminal_title"] = TITLE_ITEMS
    if tomllib.loads(result) != expected:
        raise ValueError("既存のCodex設定を保持できないため、書き換えを中止しました")
    return result


def tmux_config(text, script=None):
    script = script or str(Path(__file__).with_name("sidebar.py").resolve())
    command = shlex.join([sys.executable, script, "install"])
    block = BEGIN + "\nrun-shell -b " + shlex.quote(command) + "\n" + END
    pattern = re.escape(BEGIN) + r".*?" + re.escape(END)
    if BEGIN in text:
        if END not in text:
            raise ValueError("tmux設定のサイドバーブロックが不完全です")
        return re.sub(pattern, lambda _: block, text, flags=re.S)
    return text.rstrip() + "\n\n" + block + "\n"


def write_config(path, text):
    path = path.expanduser().resolve()
    previous = path.read_text() if path.exists() else None
    if previous == text:
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    backup = None
    if previous is not None:
        stamp = datetime.now(timezone(timedelta(hours=9))).strftime("%y%m%d_%H%M")
        backup = path.with_name(f"{stamp}_{path.name}.bak")
        suffix = 1
        while backup.exists():
            backup = path.with_name(f"{stamp}_{path.name}_{suffix}.bak")
            suffix += 1
        with os.fdopen(os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
            stream.write(previous)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=".sidebar-")
    try:
        with os.fdopen(descriptor, "w") as stream:
            stream.write(text)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return backup


def main():
    parser = argparse.ArgumentParser(description="tmux Codexサイドバーの導入")
    parser.add_argument("--tmux-config", type=Path, default=Path.home() / ".tmux.conf")
    parser.add_argument("--codex-config", type=Path,
                        default=Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "config.toml")
    parser.add_argument("--no-load", action="store_true", help="設定保存のみ。起動中のtmuxには反映しない")
    args = parser.parse_args()
    # 読み取りと保存で同じ実体を使う。引用符付きの~/...もここで展開する。
    args.codex_config = args.codex_config.expanduser().resolve()
    args.tmux_config = args.tmux_config.expanduser().resolve()
    # 両方の設定を検証してから保存する。
    changes = [(args.codex_config, codex_config(args.codex_config.read_text() if args.codex_config.exists() else "")),
               (args.tmux_config, tmux_config(args.tmux_config.read_text() if args.tmux_config.exists() else ""))]
    for path, content in changes:
        backup = write_config(path, content)
        print(f"設定: {path}")
        if backup:
            print(f"バックアップ: {backup}")
    if not args.no_load:
        tmux = Tmux()
        try:
            tmux.run("list-sessions", "-F", "#{session_id}")
        except RuntimeError:
            print("次回のtmux起動時にサイドバーが有効になります。")
        else:
            tmux.install()
            print("起動中のtmuxに反映しました。prefix + eで表示を切り替えられます。")


if __name__ == "__main__":
    main()
