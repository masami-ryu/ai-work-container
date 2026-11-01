#!/usr/bin/env python3
"""tmuxの通常paneで動くwindow一覧。Python標準ライブラリのみを使う。"""

from __future__ import annotations

import argparse
import contextlib
import curses
import fcntl
import hashlib
import json
import locale
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
from dataclasses import dataclass, replace

from codex_state import CodexStates, thread_prefix


SCRIPT = str(Path(__file__).resolve())
MARK = "@codex_sidebar"
ENABLED = "@codex_sidebar_enabled"
WIDTH = "@codex_sidebar_width"
GEOMETRY = "@codex_sidebar_geometry"
HOOK_INDEX = 7319


def clean(text):
    return "".join(c for c in text if not unicodedata.category(c).startswith("C"))


def cell_width(text):
    return sum(0 if unicodedata.combining(c) else 2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in text)


def clip(text, width):
    result = ""
    for c in clean(text):
        if cell_width(result + c) > width:
            break
        result += c
    return result


@dataclass(frozen=True)
class Row:
    id: str
    index: int
    name: str
    active: bool
    state: str = "未起動"
    detail: str = ""
    prefix: str | None = None


class StateCache:
    """サイドバー間で状態ラベルだけを共有する。会話や応答本文は保存しない。"""

    MAX_AGE = 10

    def __init__(self, path):
        self.path = path

    def _load(self):
        try:
            value = json.loads(self.path.read_text())
            if not isinstance(value, dict) or not isinstance(value.get("states"), dict):
                return {}
            if not all(isinstance(value.get(key), (int, float)) for key in ("updated_at", "request_at")):
                return {}
            return value
        except (OSError, ValueError):
            return {}

    def read(self):
        value = self._load()
        if not value or not 0 <= time.monotonic() - value["updated_at"] <= self.MAX_AGE:
            return {}
        return {key: tuple(state) for key, state in value["states"].items()
                if isinstance(state, list) and len(state) == 2 and all(isinstance(part, str) for part in state)}

    def publish(self, states, request_at):
        with self.path.with_suffix(".lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            previous = self._load().get("request_at", -1)
            if request_at < previous <= time.monotonic():
                return  # 遅れて届いた古い応答で新しい状態を巻き戻さない。
            descriptor, temporary = tempfile.mkstemp(dir=self.path.parent, prefix=".states-")
            try:
                with os.fdopen(descriptor, "w") as stream:
                    json.dump({"request_at": request_at, "updated_at": time.monotonic(), "states": states}, stream)
                os.replace(temporary, self.path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)


class Tmux:
    def __init__(self, socket_path=None):
        self.socket = socket_path or os.environ.get("TMUX", "").rsplit(",", 2)[0] or None

    def run(self, *args):
        command = ["tmux"] + (["-S", self.socket] if self.socket else []) + list(args)
        result = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=3)
        if result.returncode:
            raise RuntimeError("tmuxの操作に失敗しました。対象のwindow / paneを確認してください。")
        return result.stdout.removesuffix("\n")

    def value(self, target, expression):
        return self.run("display-message", "-p", "-t", target, expression)

    def option(self, target, name, default=""):
        value = self.value(target, "#{" + name + "}")
        return value if value else default

    def command(self, action):
        base = [sys.executable, SCRIPT]
        if self.socket:
            base += ["--socket", self.socket]
        return shlex.join(base + [action])

    def session_windows(self, session):
        return self.run("list-windows", "-t", session, "-F", "#{window_id}\t#{window_index}\t#{window_active}").splitlines()

    def pane_info(self, session):
        return [line.split("\t") for line in self.run(
            "list-panes", "-s", "-t", session, "-F",
            "#{pane_id}\t#{window_id}\t#{pane_current_command}\t#{pane_dead}\t#{@codex_sidebar}"
        ).splitlines()]

    def rows(self, session):
        rows = {}
        for line in self.session_windows(session):
            window, index, active = line.split("\t")
            rows[window] = Row(window, int(index), clean(self.value(window, "#{window_name}")), active == "1")
        agents = {}
        for pane, window, command, dead, sidebar in self.pane_info(session):
            if sidebar == "1" or dead == "1" or command != "codex":
                continue
            prefix = thread_prefix(self.value(pane, "#{pane_title}"))
            agents.setdefault(window, []).append(prefix)
        for window, prefixes in agents.items():
            if window not in rows:
                continue
            if len(prefixes) > 1:
                rows[window] = replace(rows[window], state="複数", detail="1windowにつきCodexは1つ")
            elif prefixes[0]:
                rows[window] = replace(rows[window], state="不明", prefix=prefixes[0])
            else:
                rows[window] = replace(rows[window], state="設定待ち", detail="Codexで /title app-name thread-id status")
        return list(rows.values())

    def select(self, session, window):
        # 表示後のsplit/resizeを避け、作業paneのフォーカスとwindowを一度に切り替える。
        self.ensure(session, window)
        command = []
        panes = [line.split("\t") for line in self.run(
            "list-panes", "-t", window, "-F",
            "#{pane_id}\t#{pane_active}\t#{pane_last}\t#{pane_dead}\t#{@codex_sidebar}"
        ).splitlines()]
        work = [item for item in panes if item[3] != "1" and item[4] != "1"]
        if work:
            # サイドバーをクリックした直前の作業paneはtmuxのpane_lastに残る。
            pane = next((p for p, active, *_ in work if active == "1"), None)
            pane = pane or next((p for p, _, last, *_ in work if last == "1"), work[0][0])
            command = ["select-pane", "-t", pane, ";"]
        self.run(*command, "select-window", "-t", f"{session}:{window}")

    def rename(self, window, name):
        name = clean(name).strip()
        if not name:
            return
        # rename-windowはformatも展開する。#(...)等を実行させず、名前として扱う。
        argument = name.replace("#", "##")
        if argument.endswith(";"):
            argument = argument[:-1] + "\\;"  # tmuxのargv内のコマンド区切りをエスケープ
        self.run("rename-window", "-t", window, "--", argument)
        self.run("set-option", "-w", "-t", window, "automatic-rename", "off")
        self.run("set-option", "-w", "-t", window, "allow-rename", "off")

    def move(self, session, source, target, after):
        if source == target:
            return
        ids = {line.split("\t")[0] for line in self.session_windows(session)}
        if source not in ids or target not in ids:
            return
        selected = self.value(session, "#{window_id}")
        self.run("move-window", "-a" if after else "-b", "-d", "-s", f"{session}:{source}", "-t", f"{session}:{target}")
        self.run("move-window", "-r", "-t", session)
        self.run("select-window", "-t", f"{session}:{selected}")

    def storage(self):
        directory = Path(tempfile.gettempdir()) / f"tmux-codex-sidebar-{os.getuid()}"
        directory.mkdir(mode=0o700, exist_ok=True)
        if directory.is_symlink() or directory.stat().st_uid != os.getuid():
            raise RuntimeError("サイドバーのロックディレクトリを利用できません")
        return directory

    def state_cache(self, session):
        # tmux再起動や別sessionの状態を引き継がないようserver PIDも含める。
        identity = self.value(session, "#{socket_path}:#{pid}") + ":" + session
        key = hashlib.sha256(identity.encode()).hexdigest()[:20]
        return StateCache(self.storage() / ("states-" + key + ".json"))

    def state_owner(self, session):
        panes = [pane for pane, _, _, dead, mark in self.pane_info(session) if mark == "1" and dead != "1"]
        return min(panes, key=lambda pane: int(pane[1:]), default=None)

    @contextlib.contextmanager
    def lock(self):
        key = hashlib.sha256((self.socket or "default").encode()).hexdigest()[:20]
        with (self.storage() / (key + ".lock")).open("a") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            yield

    def ensure(self, session, window=None):
        with self.lock():
            self._ensure(session, window)

    def _ensure(self, session, window=None):
        """呼び出し元がlockを保持した状態で生成・幅調整を行う。"""
        if self.option(session, ENABLED, "1") != "1":
            return
        windows = [window] if window else [line.split("\t")[0] for line in self.session_windows(session)]
        panes = self.pane_info(session)
        for window in windows:
            window_width = int(self.value(window, "#{window_width}"))
            if self.value(window, "#{window_zoomed_flag}") == "1" or window_width < 50:
                continue
            # サイドバーへのフォーカスで名前がpython3等に変わらないよう、現在の名前を保持する。
            self.run("set-option", "-w", "-t", window, "automatic-rename", "off", ";",
                     "set-option", "-w", "-t", window, "allow-rename", "off")
            pane = next((pane for pane, wid, _, _, mark in panes if wid == window and mark == "1"), None)
            if pane and self.value(pane, "#{pane_dead}") == "1":
                self.run("kill-pane", "-t", pane)
                pane = None
            if pane:
                self._sync_width(session, pane)
                continue
            width = min(max(int(self.option(session, WIDTH, "28")), 16), window_width - 30)
            command = self.command("ui") + " --session " + shlex.quote(session)
            pane = self.run("split-window", "-h", "-b", "-f", "-d", "-l", str(width),
                            "-t", window, "-P", "-F", "#{pane_id}", command)
            self.run("set-option", "-p", "-t", pane, MARK, "1", ";",
                     "set-option", "-p", "-F", "-t", pane, GEOMETRY, "#{window_width}:#{pane_width}")

    def sync_width(self, session, pane):
        with self.lock():
            self._sync_width(session, pane)

    def _sync_width(self, session, pane):
        """手動変更を保存し、自動リサイズと端末サイズ変更では保存幅を変えない。"""
        geometry = "#{window_width}:#{pane_width}"
        current, previous, zoomed = self.value(pane, geometry + "\t#{" + GEOMETRY + "}\t#{window_zoomed_flag}").split("\t")
        if zoomed == "1":
            return
        window_width, pane_width = map(int, current.split(":"))
        manual = previous and previous.split(":")[0] == str(window_width) and current != previous
        requested = max(pane_width if manual else int(self.option(session, WIDTH, "28")), 16)
        width = min(requested, window_width - 30) if window_width >= 50 else pane_width
        commands = []
        if manual:
            commands.append(shlex.join(["set-option", "-t", session, WIDTH, str(requested)]))
        if pane_width != width:
            commands.append(shlex.join(["resize-pane", "-t", pane, "-x", str(width)]))
        if commands or current != previous:
            commands.append(shlex.join(["set-option", "-p", "-F", "-t", pane, GEOMETRY, geometry]))
            # 読み取り後に境界が動いた場合は適用しない。判定と変更をtmux内で連続実行する。
            condition = "#{&&:#{==:" + geometry + "," + current + "},#{==:#{window_zoomed_flag},0}}"
            self.run("if-shell", "-F", "-t", pane, condition, " ; ".join(commands))

    def toggle(self, session):
        with self.lock():
            if self.option(session, ENABLED, "1") == "1":
                self.run("set-option", "-t", session, ENABLED, "0")
                for pane, _, _, _, sidebar in self.pane_info(session):
                    if sidebar == "1":
                        self.run("kill-pane", "-t", pane)
            else:
                self.run("set-option", "-t", session, ENABLED, "1")
                self._ensure(session)

    def install(self):
        self.run("set-option", "-g", "mouse", "on")
        command = self.command("ensure") + " --session #{q:session_id}"
        for event in ["after-new-window", "after-new-session", "session-window-changed", "client-attached", "client-resized"]:
            self.run("set-hook", "-g", f"{event}[{HOOK_INDEX}]", "run-shell -b " + shlex.quote(command))
        self.run("bind-key", "e", "run-shell", "-b", self.command("toggle") + " --session #{q:session_id}")
        # tmux 3.4は素早い2回目の押下をSecondClickにする。標準では未割当のため、
        # サイドバー内だけ転送する。既存のユーザー割当は上書きしない。
        try:
            self.run("list-keys", "-T", "root", "SecondClick1Pane")
        except RuntimeError:
            self.run("bind-key", "-T", "root", "SecondClick1Pane", "if-shell", "-F", "-t", "=",
                     "#{@codex_sidebar}", "select-pane -t = ; send-keys -M")
        try:
            sessions = self.run("list-sessions", "-F", "#{session_id}").splitlines()
        except RuntimeError:
            sessions = []  # tmux.confの読み込み時はまだsessionがない場合がある。
        for session in sessions:
            self.ensure(session)


class Snapshot:
    """通信処理がマウス追従や日本語入力を止めないよう、読み取りのみ別threadで行う。"""

    def __init__(self, tmux, session, pane, codex_socket=None, cache=None):
        self.tmux, self.session, self.pane = tmux, session, pane
        self.rows = []
        self.error = ""
        self.stop = threading.Event()
        self.refresh = threading.Event()
        self.states = CodexStates(codex_socket)
        self.cache = cache
        self.thread = threading.Thread(target=self.run, daemon=True)

    def current_rows(self):
        states = self.cache.read() if self.cache else {}
        return [replace(row, state=states[row.prefix][0], detail=states[row.prefix][1])
                if row.prefix in states else row for row in self.rows]

    def run(self):
        try:
            while not self.stop.is_set():
                try:
                    if self.cache is None:
                        self.cache = self.tmux.state_cache(self.session)
                    self.rows = self.tmux.rows(self.session)
                    self.error = ""
                    # window切替や並べ替えでは取得担当を変えず、API接続と最新結果を共有する。
                    if self.tmux.state_owner(self.session) == self.pane:
                        request_at = time.monotonic()
                        states = self.states.read([row.prefix for row in self.rows if row.prefix])
                        self.cache.publish(states, request_at)
                except (RuntimeError, OSError, ValueError, subprocess.SubprocessError):
                    self.error = "一覧を更新できません"
                self.refresh.wait(1)
                self.refresh.clear()
        finally:
            self.states.close()


class Sidebar:
    def __init__(self, screen, tmux, session, pane, codex_socket=None):
        self.screen, self.tmux, self.session, self.pane = screen, tmux, session, pane
        self.window = tmux.value(pane, "#{window_id}")
        self.snapshot = Snapshot(tmux, session, pane, codex_socket)
        self.offset = 0
        self.cursor = None
        self.drag = None
        self.drag_y = None
        self.message = ""
        self.message_until = 0
        self.size = None
        self.rows = []
        self.editing = None
        self.text = ""
        self.edit_style = curses.A_REVERSE | curses.A_BOLD
        self.lamp_styles = {"作業中": curses.A_NORMAL, "回答待ち": curses.A_NORMAL, "その他": curses.A_NORMAL}
        self.rendered = None

    def say(self, text):
        self.message, self.message_until = text, time.monotonic() + 4

    def put(self, y, x, text, attr=0):
        height, width = self.screen.getmaxyx()
        if 0 <= y < height and 0 <= x < width - 1:
            try:
                self.screen.addstr(y, x, clip(text, width - x - 1), attr)
            except curses.error:
                pass

    def row_at(self, y):
        index = self.offset + y - 1
        height, _ = self.screen.getmaxyx()
        return index if 1 <= y < height - 3 and 0 <= index < len(self.rows) else None

    def cursor_index(self):
        return next((i for i, row in enumerate(self.rows) if row.id == (self.cursor or self.window)), 0)

    def draw(self):
        height, width = self.screen.getmaxyx()
        # 非表示中も同じ取得結果で描画しておき、切替先に古い状態を残さない。
        rows = self.snapshot.current_rows()
        latest = {row.id: row for row in rows}
        if not self.drag and not self.editing:
            first_draw = not self.rows
            # このpaneが表示されるwindowを即座に強調する。ポーリング完了を待たない。
            self.rows = [replace(row, active=row.id == self.window) for row in rows]
            if first_draw:
                self.offset = max(0, self.cursor_index() - max(0, height - 5))
        else:
            # 操作中の並び順と入力文字は保持し、Codexの状態だけは更新し続ける。
            self.rows = [replace(row, state=latest[row.id].state, detail=latest[row.id].detail,
                                 prefix=latest[row.id].prefix) if row.id in latest else row for row in self.rows]
        cursor = self.cursor_index()
        self.offset = min(self.offset, max(0, len(self.rows) - max(1, height - 4)))
        detail = self.rows[cursor].detail if self.rows else ""
        footer = self.snapshot.error or (self.message if time.monotonic() < self.message_until else detail)
        rendered = (height, width, tuple(self.rows), self.cursor, cursor, self.offset, self.drag, self.drag_y,
                    self.editing, self.text, footer)
        if rendered == self.rendered:
            return
        self.rendered = rendered
        self.screen.erase()
        self.put(0, 0, " 名前の変更" if self.editing else " Windows", curses.A_BOLD)
        for index, row in enumerate(self.rows[self.offset:self.offset + max(0, height - 4)], self.offset):
            y = index - self.offset + 1
            # 選択印・区切り・状態8セル・ランプ・右端の余白に13セルを使う。
            name_width = max(1, width - 13)
            name = clip(row.name, name_width)
            line = (">" if row.active else " ") + name + " " * (name_width - cell_width(name) + 1)
            line += row.state + " " * max(0, 8 - cell_width(row.state))
            attr = curses.A_REVERSE if row.active else curses.A_NORMAL
            if row.state == "回答待ち":
                attr |= curses.A_BOLD
            if row.id == self.drag or (self.cursor and index == cursor):
                attr |= curses.A_UNDERLINE
            if row.id == self.editing:
                attr = self.edit_style
            self.put(y, 0, line, attr)
            # 名前から状態名までの強調を途切れさせず、その右にランプを置く。
            self.put(y, name_width + 11, "●", self.lamp_styles.get(row.state, self.lamp_styles["その他"]))
        if self.drag_y is not None:
            self.put(self.drag_y, 0, ">", curses.A_BOLD)
        if self.editing:
            # 入力欄全体を強調し、長い名前でも末尾と入力カーソルを表示する。
            visible = self.text
            available = max(0, width - cell_width("名前: ") - 2)
            while visible and cell_width(visible) > available:
                visible = visible[1:]
            label = "名前: " + visible
            for y, text in [(height - 3, label), (height - 2, "Enter:保存 Esc:取消"),
                            (height - 1, "Ctrl+u:全消去")]:
                self.put(y, 0, " " * (width - 1), self.edit_style)
                self.put(y, 0, text, self.edit_style)
        else:
            self.put(height - 3, 0, footer)
            self.put(height - 2, 0, "右クリック:改名  drag:移動")
            self.put(height - 1, 0, "prefix+e:表示切替")
        curses.curs_set(1 if self.editing else 0)
        if self.editing:
            self.screen.move(max(0, height - 3), max(0, min(width - 2, cell_width(label))))
        self.screen.refresh()

    def resize(self):
        size = self.screen.getmaxyx()
        if size != self.size:
            self.tmux.sync_width(self.session, self.pane)
            self.size = size

    def start_edit(self, index):
        self.cursor = self.rows[index].id
        self.editing = self.rows[index].id
        self.text = self.rows[index].name
        self.drag = self.drag_y = None

    def select(self, window):
        self.cursor = self.editing = self.drag = self.drag_y = None
        self.tmux.select(self.session, window)
        self.snapshot.refresh.set()

    def mouse(self):
        _, x, y, _, buttons = curses.getmouse()
        index = self.row_at(y)
        height, width = self.screen.getmaxyx()
        if self.editing:
            if index is not None and buttons & (curses.BUTTON1_PRESSED | curses.BUTTON1_CLICKED |
                                               curses.BUTTON3_PRESSED | curses.BUTTON3_CLICKED):
                self.editing = None
                self.cursor = None
            else:
                return
        if buttons & curses.BUTTON4_PRESSED:
            self.offset = max(0, self.offset - 3)
            return
        if buttons & getattr(curses, "BUTTON5_PRESSED", 0):
            self.offset = min(max(0, len(self.rows) - 1), self.offset + 3)
            return
        if buttons & (curses.BUTTON3_PRESSED | curses.BUTTON3_CLICKED):
            if index is not None:
                self.start_edit(index)
            return
        if buttons & curses.BUTTON1_PRESSED and self.drag is None and index is not None:
            self.cursor = self.rows[index].id
            self.drag = self.rows[index].id
            self.drag_start = x, y
            self.drag_y = None
        elif self.drag and not buttons & curses.BUTTON1_RELEASED:
            if (x, y) != self.drag_start:
                self.drag_y = y
        if buttons & curses.BUTTON1_RELEASED and self.drag:
            source = self.drag
            moved = (x, y) != self.drag_start or self.drag_y is not None
            self.drag = self.drag_y = None
            if index is not None and 0 <= x < width:
                target = self.rows[index].id
                if moved and source != target:
                    start = next(i for i, row in enumerate(self.rows) if row.id == source)
                    self.tmux.move(self.session, source, target, after=index > start)
                elif not moved:
                    self.select(target)
                self.snapshot.refresh.set()
        elif buttons & curses.BUTTON1_CLICKED and index is not None:
            self.select(self.rows[index].id)

    def key(self, key):
        if key == curses.KEY_MOUSE:
            self.mouse()
            return
        if self.editing:
            if key in ("\n", "\r", curses.KEY_ENTER):
                self.tmux.rename(self.editing, self.text)
                self.editing = self.cursor = None
                self.snapshot.refresh.set()
            elif key == "\x1b":
                self.editing = self.cursor = None
            elif key in (curses.KEY_BACKSPACE, "\x7f", "\b"):
                self.text = self.text[:-1]
            elif key == "\x15":
                self.text = ""
            elif isinstance(key, str) and key.isprintable():
                self.text += key
            return
        if key in ("j", curses.KEY_DOWN) and self.rows:
            cursor = min(len(self.rows) - 1, self.cursor_index() + 1)
            self.cursor = self.rows[cursor].id
            self.offset = max(self.offset, cursor - max(1, self.screen.getmaxyx()[0] - 5))
        elif key in ("k", curses.KEY_UP) and self.rows:
            cursor = max(0, self.cursor_index() - 1)
            self.cursor = self.rows[cursor].id
            self.offset = min(self.offset, cursor)
        elif key in ("\n", "\r", curses.KEY_ENTER) and self.rows:
            self.select(self.rows[self.cursor_index()].id)
        elif key == "r" and self.rows:
            self.start_edit(self.cursor_index())
        elif key == "\x1b":
            self.cursor = self.drag = self.drag_y = None
        elif key == "q":
            self.tmux.run("run-shell", "-b", self.tmux.command("toggle") + " --session " + shlex.quote(self.session))

    def run(self):
        if curses.has_colors():
            # ANSIの黒や太字は端末テーマによって明るい色になるため、固定パレットを使う。
            foreground, background = (16, 220) if curses.COLORS >= 256 else (curses.COLOR_BLACK, curses.COLOR_YELLOW)
            curses.init_pair(1, foreground, background)
            self.edit_style = curses.color_pair(1)
            lamp_background = 16 if curses.COLORS >= 256 else curses.COLOR_BLACK
            for pair, (state, fixed, basic) in enumerate([
                ("作業中", 46, curses.COLOR_GREEN),
                ("回答待ち", 196, curses.COLOR_RED),
                ("その他", 231, curses.COLOR_WHITE),
            ], 2):
                curses.init_pair(pair, fixed if curses.COLORS >= 256 else basic, lamp_background)
                self.lamp_styles[state] = curses.color_pair(pair)
        curses.curs_set(0)
        curses.mouseinterval(0)
        curses.mousemask(curses.ALL_MOUSE_EVENTS | curses.REPORT_MOUSE_POSITION)
        self.screen.keypad(True)
        self.screen.timeout(50)
        # 座標の符号化はcursesのterminfoに任せる。screenでSGRを強制すると
        # マウス入力を通常文字として受け取るため、移動通知(1002)だけを追加する。
        sys.stdout.write("\x1b[?1002h")
        sys.stdout.flush()
        self.snapshot.thread.start()
        try:
            while True:
                try:
                    self.resize()
                    self.draw()
                    try:
                        key = self.screen.get_wch()
                    except curses.error:
                        continue
                    self.key(key)
                except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as exc:
                    self.say(str(exc))
        finally:
            self.snapshot.stop.set()
            self.snapshot.refresh.set()
            sys.stdout.write("\x1b[?1002l")
            sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser(description="tmux Codexサイドバー")
    parser.add_argument("--socket", help="tmux socketのパス")
    parser.add_argument("action", choices=["install", "ensure", "toggle", "ui"])
    parser.add_argument("--session", help="tmux session ID")
    parser.add_argument("--codex-socket", help="CodexのUnix socket。通常は自動取得")
    args = parser.parse_args()
    tmux = Tmux(args.socket)
    if args.action == "install":
        tmux.install()
    else:
        session = args.session or tmux.value(os.environ.get("TMUX_PANE", ""), "#{session_id}")
        if args.action == "ensure":
            tmux.ensure(session)
        elif args.action == "toggle":
            tmux.toggle(session)
        else:
            locale.setlocale(locale.LC_ALL, "")
            pane = os.environ["TMUX_PANE"]
            curses.wrapper(lambda screen: Sidebar(screen, tmux, session, pane, args.codex_socket).run())


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
