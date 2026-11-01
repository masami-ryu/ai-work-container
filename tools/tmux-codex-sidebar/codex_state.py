"""CodexのローカルApp Serverから、会話履歴を要求せず状態を読む。"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import socket
import struct
import subprocess
import time


class ConnectionError(Exception):
    """接続・プロトコルエラー。会話や認証情報は例外に含めない。"""


class RPCError(ConnectionError):
    def __init__(self, error):
        super().__init__("Codexの状態を取得できませんでした")
        self.not_materialized = error.get("code") == -32600 and "not materialized" in error.get("message", "").lower()


class CodexRPC:
    """Unix socket上のWebSocket。外部ライブラリとTCP公開は不要。"""

    MAX_MESSAGE = 4 * 1024 * 1024

    def __init__(self, path: str, timeout: float = 1.5):
        self.sock = socket.socket(socket.AF_UNIX)
        self.timeout = timeout
        self.buffer = b""
        self.sequence = 0
        try:
            self.sock.settimeout(timeout)
            self.sock.connect(path)
            key = base64.b64encode(os.urandom(16)).decode()
            self.sock.sendall((
                "GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n"
                "Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\n"
                f"Sec-WebSocket-Key: {key}\r\n\r\n"
            ).encode())
            while b"\r\n\r\n" not in self.buffer:
                self._receive()
                if len(self.buffer) > 16384:
                    raise ConnectionError("WebSocketの応答が不正です")
            head, self.buffer = self.buffer.split(b"\r\n\r\n", 1)
            lines = head.decode("ascii").split("\r\n")
            headers = {name.lower(): value.strip() for name, value in
                       (line.split(":", 1) for line in lines[1:] if ":" in line)}
            expected = base64.b64encode(hashlib.sha1(
                (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()
            ).digest()).decode()
            if " 101 " not in lines[0] or headers.get("sec-websocket-accept", "") != expected:
                raise ConnectionError("WebSocket接続に失敗しました")
            self.call("initialize", {"clientInfo": {"name": "tmux_codex_sidebar", "version": "0.1.0"}})
            self._send_json({"method": "initialized"})
        except Exception:
            self.close()
            raise

    def close(self):
        self.sock.close()

    def _receive(self):
        data = self.sock.recv(65536)
        if not data:
            raise ConnectionError("Codexとの接続が閉じられました")
        self.buffer += data

    def _read(self, count):
        while len(self.buffer) < count:
            self._receive()
        result, self.buffer = self.buffer[:count], self.buffer[count:]
        return result

    def _send_frame(self, payload, opcode=1):
        length = len(payload)
        if length < 126:
            head = bytes([0x80 | opcode, 0x80 | length])
        elif length < 65536:
            head = bytes([0x80 | opcode, 0xFE]) + struct.pack("!H", length)
        else:
            head = bytes([0x80 | opcode, 0xFF]) + struct.pack("!Q", length)
        mask = os.urandom(4)
        self.sock.sendall(head + mask + bytes(value ^ mask[i % 4] for i, value in enumerate(payload)))

    def _send_json(self, value):
        self._send_frame(json.dumps(value).encode())

    def _message(self, deadline):
        message = bytearray()
        started = False
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ConnectionError("Codexの応答がタイムアウトしました")
            self.sock.settimeout(remaining)
            first, second = self._read(2)
            opcode, length = first & 15, second & 127
            if length == 126:
                length = struct.unpack("!H", self._read(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._read(8))[0]
            if second & 128 or length + len(message) > self.MAX_MESSAGE:
                raise ConnectionError("WebSocketのフレームが不正です")
            payload = self._read(length)
            if opcode == 8:
                raise ConnectionError("Codexとの接続が閉じられました")
            if opcode == 9:
                self._send_frame(payload, 10)
                continue
            if opcode == 10:
                continue
            if opcode == 1 and not started:
                started = True
            elif opcode != 0 or not started:
                raise ConnectionError("WebSocketのメッセージが不正です")
            message.extend(payload)
            if first & 128:
                return json.loads(message)

    def call(self, method, params=None):
        self.sequence += 1
        self.sock.settimeout(self.timeout)
        self._send_json({"id": self.sequence, "method": method, "params": params or {}})
        deadline = time.monotonic() + self.timeout
        while True:
            value = self._message(deadline)
            if "method" in value or value.get("id") != self.sequence:
                continue
            if "error" in value:
                raise RPCError(value["error"])
            return value["result"]


# /titleのthread-idは0.166.0で末尾が省略される。loaded threadのIDと一意に照合する。
TITLE_ID = re.compile(r"^codex \| ([0-9a-f]{8}-[0-9a-f-]{8,28})(?:\.{3}|…)?(?: \| [^\r\n|]+)?$", re.I)


def thread_prefix(title: str):
    match = TITLE_ID.fullmatch(title)
    return match.group(1).lower() if match else None


def state_label(status, latest_turn=None):
    kind = status.get("type")
    if kind == "active":
        flags = status.get("activeFlags", [])
        if "waitingOnApproval" in flags:
            return "回答待ち", "承認"
        if "waitingOnUserInput" in flags:
            return "回答待ち", "質問"
        return "作業中", ""
    if kind == "systemError":
        return "異常", ""
    if kind == "idle":
        if latest_turn is None:
            return "未開始", ""
        return {"completed": ("完了", ""), "interrupted": ("中断", ""),
                "failed": ("異常", ""), "inProgress": ("不明", "状態更新待ち")}.get(
                    latest_turn.get("status"), ("不明", "未対応の状態"))
    return "不明", "未接続"


class CodexStates:
    def __init__(self, socket_path=None):
        self.socket_path = socket_path
        self.rpc = None
        self.retry_at = 0.0
        self.turns = {}

    def close(self):
        if self.rpc:
            self.rpc.close()
            self.rpc = None

    def read(self, prefixes):
        if not prefixes:
            return {}
        unknown = {prefix: ("不明", "Codex接続待ち") for prefix in prefixes}
        if time.monotonic() < self.retry_at:
            return unknown
        try:
            if self.rpc is None:
                path = self.socket_path
                if not path:
                    result = subprocess.run(["codex", "app-server", "daemon", "version"],
                                            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=3, check=True)
                    info = json.loads(result.stdout)
                    if info.get("status") != "running":
                        return unknown
                    path = info["socketPath"]
                self.rpc = CodexRPC(path)
                self.turns.clear()
            loaded = self.rpc.call("thread/loaded/list")["data"]
            self.turns = {key: value for key, value in self.turns.items() if key in loaded}
            result = {}
            for prefix in set(prefixes):
                matches = [value for value in loaded if value.startswith(prefix)]
                if len(matches) != 1:
                    result[prefix] = ("不明", "threadを特定できません")
                    continue
                thread_id = matches[0]
                try:
                    status = self.rpc.call("thread/read", {"threadId": thread_id, "includeTurns": False})["thread"]["status"]
                except RPCError:
                    result[prefix] = ("不明", "threadの取得失敗")
                    continue
                latest = None
                if status.get("type") == "idle":
                    cached = self.turns.get(thread_id)
                    if cached is None or time.monotonic() - cached[0] >= 2:
                        try:
                            turns = self.rpc.call("thread/turns/list", {
                                "threadId": thread_id, "limit": 1, "sortDirection": "desc", "itemsView": "notLoaded"
                            })["data"]
                        except RPCError as exc:
                            if not exc.not_materialized:
                                result[prefix] = ("不明", "最新turnの取得失敗")
                                continue
                            turns = []
                        latest = turns[0] if turns else None
                        self.turns[thread_id] = (time.monotonic(), latest)
                    else:
                        latest = cached[1]
                else:
                    self.turns.pop(thread_id, None)
                result[prefix] = state_label(status, latest)
            return result
        except (ConnectionError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            self.close()
            self.retry_at = time.monotonic() + 5
            return unknown
