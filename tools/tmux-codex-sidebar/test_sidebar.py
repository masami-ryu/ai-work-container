"""分離したtmux serverで、通常paneを維持したまま操作できることを検証する。"""

import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time
import tomllib
import unittest
from unittest.mock import MagicMock, patch

from codex_state import CodexRPC, CodexStates, RPCError, state_label, thread_prefix
from sidebar import GEOMETRY, WIDTH, Row, Sidebar, Snapshot, StateCache, Tmux, clip, cell_width
from setup import TITLE_ITEMS, codex_config, tmux_config, write_config


class StateTests(unittest.TestCase):
    def test_explicit_wait_and_completion_states(self):
        self.assertEqual(state_label({"type": "active", "activeFlags": []})[0], "作業中")
        self.assertEqual(state_label({"type": "active", "activeFlags": ["waitingOnApproval"]}), ("回答待ち", "承認"))
        self.assertEqual(state_label({"type": "active", "activeFlags": ["waitingOnUserInput"]}), ("回答待ち", "質問"))
        for status, expected in [(None, "未開始"), ("completed", "完了"), ("interrupted", "中断"), ("failed", "異常")]:
            self.assertEqual(state_label({"type": "idle"}, {"status": status} if status else None)[0], expected)
        self.assertEqual(state_label({"type": "notLoaded"})[0], "不明")

    def test_title_prefix_and_unicode_width(self):
        self.assertEqual(thread_prefix("codex | 01234567-1234-5678-9012-abcd... | Ready"), "01234567-1234-5678-9012-abcd")
        self.assertIsNone(thread_prefix("codex | my project | Ready"))
        self.assertIsNone(thread_prefix("shell | 01234567-1234-5678-9012-abcd..."))
        self.assertEqual(clip("日本語abc", 7), "日本語a")
        self.assertEqual(cell_width("e\u0301"), 1)

    def test_ambiguous_prefix_and_unmaterialized_thread(self):
        class RPC:
            def call(self, method, params=None):
                if method == "thread/loaded/list":
                    return {"data": ["abc-1", "abc-2", "new-1", "done-1"]}
                if method == "thread/read":
                    return {"thread": {"status": {"type": "idle"}}}
                if params["threadId"] == "new-1":
                    raise RPCError({"code": -32600, "message": "thread is not materialized"})
                return {"data": [{"status": "completed"}]}
        states = CodexStates()
        states.rpc = RPC()
        result = states.read(["abc", "new", "done"])
        self.assertEqual(result["abc"][0], "不明")
        self.assertEqual(result["new"][0], "未開始")
        self.assertEqual(result["done"][0], "完了")

    def test_rpc_uses_masking_fragmentation_and_ping(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "socket")
            server = socket.socket(socket.AF_UNIX)
            server.bind(path)
            server.listen()
            errors = []

            def serve():
                try:
                    connection, _ = server.accept()
                    connection.settimeout(2)
                    with connection:
                        header = b""
                        while b"\r\n\r\n" not in header:
                            header += connection.recv(1)
                        key = next(line.split(b":", 1)[1].strip() for line in header.split(b"\r\n") if line.startswith(b"Sec-WebSocket-Key:"))
                        accept = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
                        connection.sendall(b"HTTP/1.1 101 Switching Protocols\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n")

                        def read(count):
                            result = b""
                            while len(result) < count:
                                value = connection.recv(count - len(result))
                                if not value:
                                    raise EOFError()
                                result += value
                            return result

                        def message():
                            first, second = read(2)
                            self.assertTrue(second & 128)
                            length = second & 127
                            if length == 126:
                                length = struct.unpack("!H", read(2))[0]
                            mask = read(4)
                            body = bytes(value ^ mask[i % 4] for i, value in enumerate(read(length)))
                            return first & 15, body

                        _, request = message()
                        response = json.dumps({"id": json.loads(request)["id"], "result": {}}).encode()
                        midpoint = len(response) // 2
                        connection.sendall(bytes([1, midpoint]) + response[:midpoint])
                        connection.sendall(b"\x89\x01x")
                        self.assertEqual(message(), (10, b"x"))
                        connection.sendall(bytes([0x80, len(response) - midpoint]) + response[midpoint:])
                        self.assertEqual(json.loads(message()[1])["method"], "initialized")
                        _, request = message()
                        self.assertEqual(json.loads(request)["method"], "thread/loaded/list")
                        unsolicited = json.dumps({"id": json.loads(request)["id"], "method": "item/tool/requestUserInput", "params": {}}).encode()
                        connection.sendall(bytes([0x81, len(unsolicited)]) + unsolicited)
                        response = json.dumps({"id": json.loads(request)["id"], "result": {"data": []}}).encode()
                        connection.sendall(bytes([0x81, len(response)]) + response)
                except BaseException as exc:
                    errors.append(exc)

            worker = threading.Thread(target=serve)
            worker.start()
            client = CodexRPC(path)
            self.assertEqual(client.call("thread/loaded/list"), {"data": []})
            client.close()
            worker.join(3)
            server.close()
            self.assertFalse(worker.is_alive())
            if errors:
                raise errors[0]


class SetupTests(unittest.TestCase):
    def test_cli_expands_home_paths_before_reading_existing_settings(self):
        with tempfile.TemporaryDirectory(prefix=".sidebar-tests-", dir=Path.home()) as directory:
            root = Path(directory)
            codex = root / "config.toml"
            tmux = root / "tmux.conf"
            codex.write_text('model = "existing"\n')
            tmux.write_text("set -g history-limit 1234\n")
            result = subprocess.run([
                sys.executable, str(Path(__file__).with_name("setup.py")), "--no-load",
                "--codex-config", "~/" + str(codex.relative_to(Path.home())),
                "--tmux-config", "~/" + str(tmux.relative_to(Path.home())),
            ], capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(tomllib.loads(codex.read_text()), {
                "model": "existing", "tui": {"terminal_title": TITLE_ITEMS}})
            self.assertIn("set -g history-limit 1234", tmux.read_text())
            self.assertEqual(len(list(root.glob("*.bak"))), 2)

    def test_preserve_other_settings_and_idempotency(self):
        for original in ["", 'model = "example"\n',
                         '[tui]\nnotifications = false\n',
                         '[tui]\nterminal_title = [\n "project",\n "status",\n]\nnotifications = true\n[other]\nvalue = 4\n']:
            with self.subTest(original=original):
                result = codex_config(original)
                expected = tomllib.loads(original)
                expected.setdefault("tui", {})["terminal_title"] = TITLE_ITEMS
                self.assertEqual(tomllib.loads(result), expected)
                self.assertEqual(codex_config(result), result)
        original = "set -g mouse on\n"
        result = tmux_config(original, "/tmp/a path/sidebar.py")
        self.assertTrue(result.startswith(original))
        self.assertEqual(tmux_config(result, "/tmp/a path/sidebar.py"), result)

    def test_backup_and_preserve_persistent_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "persistent.toml"
            target.write_text("original\n")
            link = Path(directory) / "config.toml"
            link.symlink_to(target)
            backup = write_config(link, "changed\n")
            self.assertTrue(link.is_symlink())
            self.assertEqual(backup.read_text(), "original\n")
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
            self.assertEqual(target.read_text(), "changed\n")
            self.assertIsNone(write_config(link, "changed\n"))


class StateCacheTests(unittest.TestCase):
    def test_shared_result_rejects_old_replies_and_expires(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "states.json"
            writer, reader = StateCache(path), StateCache(path)
            old = time.monotonic()
            writer.publish({"thread": ("作業中", "")}, old)
            self.assertEqual(reader.read()["thread"][0], "作業中")
            writer.publish({"thread": ("回答待ち", "承認")}, time.monotonic())
            writer.publish({"thread": ("作業中", "")}, old)
            self.assertEqual(reader.read()["thread"], ("回答待ち", "承認"))
            # 実際の取得失敗は直前の正常値で隠さない。
            writer.publish({"thread": ("不明", "Codex接続待ち")}, time.monotonic())
            self.assertEqual(reader.read()["thread"][0], "不明")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with patch("sidebar.time.monotonic", return_value=time.monotonic() + StateCache.MAX_AGE + 1):
                self.assertEqual(reader.read(), {})


class SnapshotTests(unittest.TestCase):
    def test_draw_uses_shared_state_without_waiting_for_metadata_refresh(self):
        with tempfile.TemporaryDirectory() as directory, patch("sidebar.curses.curs_set"):
            path = Path(directory) / "states.json"
            writer = StateCache(path)
            screen, backend = MagicMock(), MagicMock()
            screen.getmaxyx.return_value = (30, 28)
            backend.value.return_value = "@0"
            sidebar = Sidebar(screen, backend, "$0", "%1")
            sidebar.snapshot.cache = StateCache(path)
            sidebar.snapshot.rows = [Row("@0", 0, "A", True, "不明", prefix="thread")]
            for state in ("作業中", "回答待ち", "完了"):
                writer.publish({"thread": (state, "")}, time.monotonic())
                screen.addstr.reset_mock()
                sidebar.draw()
                body = next(call.args[2] for call in screen.addstr.call_args_list if call.args[:2] == (1, 0))
                self.assertIn(state, body)
                self.assertNotIn("不明", body)

    def test_inactive_snapshot_uses_shared_state_during_slow_refresh(self):
        class Backend:
            def rows(self, session):
                return [Row("@0", 0, "A", True, "不明", prefix="thread")]

            def state_owner(self, session):
                return "%1"

        entered, release = threading.Event(), threading.Event()

        class States:
            def read(self, prefixes):
                entered.set()
                release.wait(3)
                return {"thread": ("回答待ち", "承認")}

            def close(self):
                pass

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "states.json"
            owner = Snapshot(Backend(), "$0", "%1", cache=StateCache(path))
            follower = Snapshot(Backend(), "$0", "%2", cache=StateCache(path))
            owner.cache.publish({"thread": ("作業中", "")}, time.monotonic())
            owner.states = States()
            follower.states = MagicMock()
            owner.thread.start()
            try:
                self.assertTrue(entered.wait(2))
                follower.thread.start()
                deadline = time.monotonic() + 2
                while not follower.rows and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertEqual(owner.current_rows()[0].state, "作業中")
                self.assertEqual(follower.current_rows()[0].state, "作業中")
                release.set()
                deadline = time.monotonic() + 2
                while follower.current_rows()[0].state != "回答待ち" and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertEqual(follower.current_rows()[0].state, "回答待ち")
                self.assertEqual(follower.current_rows()[0].detail, "承認")
                follower.states.read.assert_not_called()
                # threadが変わった場合は前のthreadの状態を使わない。
                follower.rows = [Row("@0", 0, "A", True, "不明", prefix="new-thread")]
                self.assertEqual(follower.current_rows()[0].state, "不明")
            finally:
                release.set()
                for snapshot in (owner, follower):
                    snapshot.stop.set()
                    snapshot.refresh.set()
                    if snapshot.thread.ident:
                        snapshot.thread.join(3)
                self.assertFalse(owner.thread.is_alive() or follower.thread.is_alive())

    def test_narrow_sidebar_keeps_japanese_names_states_and_lamps(self):
        states = ["作業中", "回答待ち", "完了", "不明"]
        for width in [16, 17, 24, 28]:
            with self.subTest(width=width), patch("sidebar.curses.curs_set"):
                screen, backend = MagicMock(), MagicMock()
                screen.getmaxyx.return_value = (30, width)
                backend.value.return_value = "@0"
                sidebar = Sidebar(screen, backend, "$0", "%1")
                sidebar.snapshot.rows = [Row(f"@{i}", i, name, i == 0, state)
                                         for i, (name, state) in enumerate(zip(
                                             ["開発A", "確認B", "保存C", "試験D"], states))]
                sidebar.draw()
                for y, initial, state in zip(range(1, 5), "開確保試", states):
                    calls = [call.args for call in screen.addstr.call_args_list if call.args[0] == y]
                    body = next(call for call in calls if call[1] == 0)
                    lamp = next(call for call in calls if call[2] == "●")
                    self.assertIn(initial, body[2])
                    self.assertIn(state, body[2])
                    self.assertLess(cell_width(body[2]), lamp[1])
                    self.assertLess(lamp[1] + cell_width(lamp[2]), width)

    def test_editing_keeps_input_and_order_while_states_update(self):
        class Screen:
            def __init__(self):
                self.lines = []

            def getmaxyx(self):
                return 30, 28

            def erase(self):
                self.lines.clear()

            def addstr(self, y, x, text, attr):
                self.lines.append(text)

            def move(self, *args):
                pass

            def refresh(self):
                pass

        class Backend:
            def value(self, *args):
                return "@0"

        screen = Screen()
        sidebar = Sidebar(screen, Backend(), "$0", "%1")
        sidebar.snapshot.rows = [Row("@0", 0, "A", True, "作業中"), Row("@1", 1, "B", False, "作業中")]
        with patch("sidebar.curses.curs_set"):
            sidebar.draw()
            sidebar.start_edit(0)
            sidebar.key("X")
            sidebar.snapshot.rows = [Row("@1", 0, "B", False, "回答待ち", "承認"), Row("@0", 1, "A", True, "完了")]
            sidebar.draw()
            self.assertEqual(sidebar.editing, "@0")
            self.assertEqual(sidebar.text, "AX")
            self.assertEqual([row.id for row in sidebar.rows], ["@0", "@1"])
            self.assertEqual([row.state for row in sidebar.rows], ["完了", "回答待ち"])
            self.assertEqual(sidebar.rows[1].detail, "承認")
            self.assertTrue(any("回答待ち" in line for line in screen.lines))
            sidebar.key("\x1b")
            sidebar.draw()
            self.assertEqual([row.id for row in sidebar.rows], ["@1", "@0"])

    def test_window_list_is_available_while_codex_is_slow(self):
        class Backend:
            def rows(self, session):
                return [Row("@1", 0, "A", True, prefix="thread")]

            def state_owner(self, session):
                return "%1"

        entered, release = threading.Event(), threading.Event()

        class States:
            def read(self, prefixes):
                entered.set()
                release.wait(3)
                return {"thread": ("作業中", "")}

            def close(self):
                pass

        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        snapshot = Snapshot(Backend(), "$1", "%1", cache=StateCache(Path(directory.name) / "states.json"))
        snapshot.states = States()
        snapshot.thread.start()
        try:
            self.assertTrue(entered.wait(2))
            self.assertEqual([row.id for row in snapshot.rows], ["@1"])
        finally:
            snapshot.stop.set()
            snapshot.refresh.set()
            release.set()
            snapshot.thread.join(3)
        self.assertFalse(snapshot.thread.is_alive())


@unittest.skipUnless(shutil.which("tmux"), "tmuxが必要です")
class TmuxTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="sidebar-tests-")
        self.path = str(Path(self.directory.name) / "tmux")
        self.tmux = Tmux(self.path)
        self.session = self.tmux.run("-f", "/dev/null", "new-session", "-d", "-x", "120", "-y", "35", "-s", "test", "-n", "A", "-P", "-F", "#{session_id}", "sleep 300")
        for name in ["B", "C", "D"]:
            self.tmux.run("new-window", "-d", "-t", self.session, "-n", name, "sleep 300")
        self.ids = [row.id for row in self.tmux.rows(self.session)]
        self.client = None
        self.fd = None

    def tearDown(self):
        if self.client:
            self.client.terminate()
            try:
                self.client.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.client.kill()
                self.client.wait()
        if self.fd is not None:
            os.close(self.fd)
        subprocess.run(["tmux", "-S", self.path, "kill-server"], capture_output=True)
        self.directory.cleanup()

    def wait(self, check, timeout=5):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            self.drain()
            if check():
                return
            time.sleep(.04)
        self.fail("状態の反映がタイムアウトしました")

    def drain(self):
        if self.fd is not None:
            while select.select([self.fd], [], [], 0)[0]:
                try:
                    if not os.read(self.fd, 65536):
                        break
                except OSError:
                    break

    def attach(self):
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 35, 120, 0, 0))
        env = {**os.environ, "TERM": "xterm-256color", "LC_ALL": "C.UTF-8"}
        env.pop("TMUX", None)
        self.client = subprocess.Popen(["tmux", "-S", self.path, "attach-session", "-t", self.session],
                                       stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True)
        os.close(slave)
        self.fd = master

    def sidebar(self, window=None):
        window = window or self.ids[0]
        return next((pane for pane, wid, _, _, mark in self.tmux.pane_info(self.session) if wid == window and mark == "1"), None)

    def capture(self, pane):
        return self.tmux.run("capture-pane", "-p", "-t", pane)

    def mouse(self, button, x, y, release=False):
        os.write(self.fd, f"\x1b[<{button};{x};{y}{'m' if release else 'M'}".encode())
        time.sleep(.08)
        self.drain()

    def test_insert_reorder_name_and_selection(self):
        self.tmux.move(self.session, self.ids[0], self.ids[2], True)
        self.assertEqual([row.name for row in self.tmux.rows(self.session)], ["B", "C", "A", "D"])
        self.assertEqual(self.tmux.value(self.session, "#{window_id}"), self.ids[0])
        self.tmux.move(self.session, self.ids[3], self.ids[1], False)
        self.assertEqual([row.name for row in self.tmux.rows(self.session)], ["D", "B", "C", "A"])
        name = '名前 "quoted" $(touch SHOULD_NOT_EXIST); #'
        self.tmux.rename(self.ids[0], name)
        self.assertEqual(self.tmux.value(self.ids[0], "#{window_name}"), name)
        self.assertFalse(Path("SHOULD_NOT_EXIST").exists())
        self.assertEqual(self.tmux.option(self.ids[0], "automatic-rename"), "0")
        for name in ["-leading", ";", "ends;", "literal #{window_index} #(touch SHOULD_NOT_EXIST)"]:
            self.tmux.rename(self.ids[0], name)
            self.assertEqual(self.tmux.value(self.ids[0], "#{window_name}"), name)
        self.assertFalse(Path("SHOULD_NOT_EXIST").exists())

    def test_state_owner_and_cache_survive_window_switches(self):
        self.tmux.install()
        owner = self.tmux.state_owner(self.session)
        cache_path = self.tmux.state_cache(self.session).path
        self.tmux.select(self.session, self.ids[-1])
        self.tmux.move(self.session, self.ids[0], self.ids[-1], True)
        self.assertEqual(self.tmux.state_owner(self.session), owner)
        self.assertEqual(self.tmux.state_cache(self.session).path, cache_path)
        other = self.tmux.run("new-session", "-d", "-s", "other", "-P", "-F", "#{session_id}", "sleep 300")
        self.assertNotEqual(self.tmux.state_cache(other).path, cache_path)
        self.tmux.run("kill-pane", "-t", owner)
        self.assertNotEqual(self.tmux.state_owner(self.session), owner)

    def test_saved_config_creates_sidebar_on_startup(self):
        config = Path(self.directory.name) / "tmux.conf"
        config.write_text(tmux_config(""))
        socket_path = str(Path(self.directory.name) / "startup")
        tmux = Tmux(socket_path)
        try:
            session = tmux.run("-f", str(config), "new-session", "-d", "-x", "120", "-y", "35", "-P", "-F", "#{session_id}", "sleep 300")
            self.wait(lambda: any(mark == "1" for *_, mark in tmux.pane_info(session)))
            window = tmux.run("new-window", "-t", session, "-n", "new", "-P", "-F", "#{window_id}", "sleep 300")
            self.wait(lambda: any(wid == window and mark == "1" for _, wid, _, _, mark in tmux.pane_info(session)))
        finally:
            subprocess.run(["tmux", "-S", socket_path, "kill-server"], capture_output=True)

    def test_hooks_width_and_toggle_preserve_work_panes(self):
        original = {pane for pane, *_ in self.tmux.pane_info(self.session)}
        self.tmux.install()
        first = self.sidebar()
        self.assertIsNotNone(first)
        self.tmux.ensure(self.session)
        self.assertEqual(sum(mark == "1" for *_, mark in self.tmux.pane_info(self.session)), 4)
        self.wait(lambda: "Windows" in self.capture(first))
        self.tmux.run("resize-pane", "-t", first, "-x", "34")
        self.wait(lambda: self.tmux.option(self.session, "@codex_sidebar_width") == "34")
        self.tmux.select(self.session, self.ids[1])
        self.wait(lambda: self.sidebar(self.ids[1]) is not None)
        self.assertEqual(self.tmux.value(self.sidebar(self.ids[1]), "#{pane_width}"), "34")
        self.tmux.toggle(self.session)
        self.assertEqual({pane for pane, *_ in self.tmux.pane_info(self.session)}, original)
        self.tmux.select(self.session, self.ids[0])
        time.sleep(.1)
        self.assertIsNone(self.sidebar())
        self.tmux.toggle(self.session)
        self.assertIsNotNone(self.sidebar())

    def test_switch_preserves_active_and_last_work_pane(self):
        second = self.tmux.run("split-window", "-h", "-t", self.ids[1], "-P", "-F", "#{pane_id}", "sleep 300")
        self.tmux.install()
        self.tmux.run("select-pane", "-t", second)
        self.tmux.select(self.session, self.ids[0])
        self.tmux.select(self.session, self.ids[1])
        self.assertEqual(self.tmux.value(self.ids[1], "#{pane_id}"), second)
        self.tmux.run("select-pane", "-t", self.sidebar(self.ids[1]))
        self.tmux.select(self.session, self.ids[0])
        self.tmux.select(self.session, self.ids[1])
        self.assertEqual(self.tmux.value(self.ids[1], "#{pane_id}"), second)

    def test_toggle_waits_for_creation_and_removes_sidebar(self):
        entered, release, toggled = threading.Event(), threading.Event(), threading.Event()
        errors = []

        class DelayedTmux(Tmux):
            def run(self, *args):
                if args[0] == "split-window":
                    entered.set()
                    release.wait(5)
                return super().run(*args)

        def create():
            try:
                DelayedTmux(self.path).ensure(self.session, self.ids[0])
            except Exception as exc:
                errors.append(exc)

        def toggle():
            try:
                self.tmux.toggle(self.session)
            except Exception as exc:
                errors.append(exc)
            finally:
                toggled.set()

        creator = threading.Thread(target=create)
        toggler = threading.Thread(target=toggle)
        creator.start()
        try:
            self.assertTrue(entered.wait(2))
            toggler.start()
            self.assertFalse(toggled.wait(.1))
        finally:
            release.set()
            creator.join(5)
            if toggler.ident:
                toggler.join(5)
        self.assertFalse(creator.is_alive() or toggler.is_alive())
        self.assertFalse(errors)
        self.assertEqual(self.tmux.option(self.session, "@codex_sidebar_enabled"), "0")
        self.assertFalse(any(mark == "1" for *_, mark in self.tmux.pane_info(self.session)))

    def test_manual_width_wins_over_background_sync(self):
        self.tmux.install()
        pane = self.sidebar()
        self.wait(lambda: "D" in self.capture(pane))
        # 他windowから共有された32桁を背景処理が適用する直前に、手動で34桁へ変更する。
        self.tmux.run("set-option", "-t", self.session, WIDTH, "32")
        entered, release = threading.Event(), threading.Event()
        errors = []

        class DelayedTmux(Tmux):
            def option(self, target, name, default=""):
                value = super().option(target, name, default)
                if name == WIDTH:
                    entered.set()
                    release.wait(5)
                return value

        def ensure():
            try:
                DelayedTmux(self.path).ensure(self.session, self.ids[0])
            except Exception as exc:
                errors.append(exc)

        worker = threading.Thread(target=ensure)
        worker.start()
        try:
            self.assertTrue(entered.wait(2))
            self.tmux.run("resize-pane", "-t", pane, "-x", "34")
        finally:
            release.set()
            worker.join(5)
        self.assertFalse(worker.is_alive())
        self.assertFalse(errors)
        self.wait(lambda: self.tmux.option(self.session, WIDTH) == "34")
        self.tmux.ensure(self.session)
        self.assertEqual(self.tmux.value(pane, "#{pane_width}"), "34")
        for window in self.ids:
            self.assertEqual(self.tmux.value(self.sidebar(window), "#{pane_width}"), "34")
        self.assertEqual(self.tmux.option(self.session, WIDTH), "34")

    def test_terminal_resize_does_not_replace_saved_sidebar_width(self):
        self.tmux.install()
        self.attach()
        pane = self.sidebar()
        self.wait(lambda: "D" in self.capture(pane))
        self.tmux.run("resize-pane", "-t", pane, "-x", "34")
        self.wait(lambda: self.tmux.option(self.session, WIDTH) == "34")
        for columns, expected in [(60, 30), (120, 34)]:
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 35, columns, 0, 0))
            self.client.send_signal(signal.SIGWINCH)
            self.wait(lambda: self.tmux.option(pane, GEOMETRY) == f"{columns}:{expected}")
            self.assertEqual(self.tmux.value(pane, "#{pane_width}"), str(expected))
            self.assertEqual(self.tmux.option(self.session, WIDTH), "34")

    def test_unnamed_windows_keep_names_when_sidebar_gets_focus(self):
        # -n付きのwindowは自動命名が無効になるため、名前未指定のwindowで再現する。
        original = self.tmux.run("new-window", "-d", "-t", self.session, "-P", "-F", "#{window_id}", "sleep 300")
        self.assertEqual(self.tmux.option(original, "automatic-rename"), "1")
        self.tmux.install()
        self.attach()
        # 導入後に追加したwindowもhookで保護する。
        added = self.tmux.run("new-window", "-d", "-t", self.session, "-P", "-F", "#{window_id}", "sleep 300")
        self.wait(lambda: self.sidebar(added) is not None)
        for window in [original, added]:
            name = self.tmux.value(window, "#{window_name}")
            self.tmux.select(self.session, window)
            pane = self.sidebar(window)
            self.tmux.run("select-pane", "-t", pane)
            time.sleep(.7)  # 自動命名のタイマーが発火するまで待つ。
            self.assertEqual(self.tmux.value(window, "#{window_name}"), name)
            self.tmux.select(self.session, window)
            time.sleep(.7)
            self.assertEqual(self.tmux.value(window, "#{window_name}"), name)
            self.assertEqual(self.tmux.option(window, "automatic-rename"), "0")
            self.assertEqual(self.tmux.option(window, "allow-rename"), "0")
        # サイドバーのないwindowに対するグローバル設定は変更しない。
        self.assertEqual(self.tmux.run("show-options", "-gwv", "automatic-rename"), "on")

    def test_repeated_clicks_highlight_layout_and_leaving_rename(self):
        # 実環境のSGRと、別テストのscreen/legacy両方を検証する。
        self.tmux.run("set-option", "-g", "default-terminal", "tmux-256color")
        # detached時とattach後のstatus行による高さの差を除いて比較する。
        self.tmux.run("set-option", "-g", "status", "off")
        self.tmux.install()
        self.attach()
        for window in self.ids:
            self.wait(lambda: "D" in self.capture(self.sidebar(window)))
        layouts = {window: self.tmux.value(window, "#{window_layout}") for window in self.ids}

        def highlighted(pane):
            reverse, result = False, []
            for line in self.tmux.run("capture-pane", "-ep", "-t", pane).splitlines():
                for part in re.split(r"(\x1b\[[0-9;]*m)", line):
                    if part.startswith("\x1b["):
                        for code in part[2:-1].split(";"):
                            if code in ("", "0", "27"):
                                reverse = False
                            elif code == "7":
                                reverse = True
                    elif reverse and part.startswith(">"):
                        result.append(part[1:2])
            return result

        # 非表示中から正しい選択行を用意し、切替後のポーリングを待たせない。
        for index, window in enumerate(self.ids):
            self.assertEqual(highlighted(self.sidebar(window)), ["ABCD"[index]])
        for index in [3, 0, 2, 1, 3, 0, 3, 2, 0]:
            self.mouse(0, 4, index + 2)
            self.mouse(0, 4, index + 2, release=True)
            self.wait(lambda: self.tmux.value(self.session, "#{window_id}") == self.ids[index])
            self.assertEqual(highlighted(self.sidebar(self.ids[index])), ["ABCD"[index]])
            self.assertNotEqual(self.tmux.value(self.session, "#{pane_id}"), self.sidebar(self.ids[index]))
        self.assertEqual([row.id for row in self.tmux.rows(self.session)], self.ids)
        self.assertEqual({window: self.tmux.value(window, "#{window_layout}") for window in self.ids}, layouts)

        # 最下段に改名中のUIを残して戻っても、一覧クリックで取り消して移動できる。
        self.tmux.select(self.session, self.ids[3])
        pane = self.sidebar(self.ids[3])
        time.sleep(.35)
        self.mouse(2, 4, 5)
        self.mouse(2, 4, 5, release=True)
        self.wait(lambda: "名前:" in self.capture(pane))
        os.write(self.fd, b"\x15draft")
        self.wait(lambda: "draft" in self.capture(pane))
        self.tmux.select(self.session, self.ids[0])
        time.sleep(.35)
        self.mouse(0, 4, 5)
        self.mouse(0, 4, 5, release=True)
        self.wait(lambda: self.tmux.value(self.session, "#{window_id}") == self.ids[3])
        self.mouse(0, 4, 2)
        self.mouse(0, 4, 2, release=True)
        self.wait(lambda: self.tmux.value(self.session, "#{window_id}") == self.ids[0])
        self.assertEqual(self.tmux.value(self.ids[3], "#{window_name}"), "D")
        self.assertNotIn("名前:", self.capture(pane))

    def test_mouse_rename_drag_select_and_border_resize(self):
        self.tmux.install()
        self.attach()
        pane = self.sidebar()
        self.wait(lambda: "D" in self.capture(pane))
        self.mouse(2, 4, 3)  # Bの右クリック
        self.wait(lambda: "名前:" in self.capture(pane))
        self.mouse(2, 4, 3, release=True)
        os.write(self.fd, "\x15変更済み\r".encode())
        self.wait(lambda: self.tmux.value(self.ids[1], "#{window_name}") == "変更済み")
        self.wait(lambda: "変更" in self.capture(pane))
        # tmux 3.4本体は異なるボタンへの300ms以内の切替を破棄する。
        # 名前入力と次の独立した操作を、click timerの期間以上離す。
        time.sleep(.35)
        self.mouse(0, 4, 2)  # AをCの下へ
        self.mouse(32, 4, 4)
        self.mouse(0, 4, 4, release=True)
        self.wait(lambda: [row.id for row in self.tmux.rows(self.session)] == [self.ids[1], self.ids[2], self.ids[0], self.ids[3]])
        self.assertEqual(self.tmux.value(self.session, "#{window_id}"), self.ids[0])
        # 通常の境界ドラッグを妨げない。
        self.mouse(0, 29, 10)
        self.mouse(32, 35, 10)
        self.mouse(0, 35, 10, release=True)
        self.wait(lambda: int(self.tmux.value(pane, "#{pane_width}")) > 28)
        width = self.tmux.value(pane, "#{pane_width}")
        self.wait(lambda: self.tmux.option(self.session, "@codex_sidebar_width") == width)
        self.mouse(0, 4, 3)  # Cへ切替
        self.mouse(0, 4, 3, release=True)
        self.wait(lambda: self.tmux.value(self.session, "#{window_id}") == self.ids[2])
        self.wait(lambda: self.sidebar(self.ids[2]) is not None)
        self.assertEqual(self.tmux.value(self.sidebar(self.ids[2]), "#{pane_width}"), width)
        self.tmux.run("send-keys", "-t", self.sidebar(self.ids[2]), "q")
        self.wait(lambda: all(mark != "1" for *_, mark in self.tmux.pane_info(self.session)))
        self.assertEqual(len(self.tmux.session_windows(self.session)), 4)


if __name__ == "__main__":
    unittest.main()
