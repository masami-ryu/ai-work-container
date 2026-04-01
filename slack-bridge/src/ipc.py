"""IPC サーバー: Unix Domain Socket でデーモンと CLI 間を通信"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import stat
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .session import SessionManager

logger = logging.getLogger(__name__)

# IPC メッセージのサイズ上限 (1MB)
MAX_IPC_MESSAGE_SIZE = 1024 * 1024

# TASK-602: prompt の長さ制限
MAX_PROMPT_LENGTH = 100_000  # 100K 文字


def get_socket_path() -> str:
    """ソケットパスを取得する。SB_SOCK > $XDG_RUNTIME_DIR/sb.sock > /tmp/sb.sock"""
    if env := os.environ.get("SB_SOCK"):
        return env
    runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
    if runtime_dir:
        return os.path.join(runtime_dir, "sb.sock")
    return "/tmp/sb.sock"


class IPCServer:
    """Unix Domain Socket ベースの IPC サーバー。"""

    def __init__(self, session_manager: SessionManager, socket_path: str | None = None) -> None:
        self._session_manager = session_manager
        self._socket_path = socket_path or get_socket_path()
        self._server: asyncio.AbstractServer | None = None
        self._draining = False

    @property
    def socket_path(self) -> str:
        return self._socket_path

    async def start(self) -> None:
        """IPC サーバーを起動する。stale socket の回復と権限検証を行う。"""
        path = Path(self._socket_path)

        # stale socket の検査
        if path.exists():
            if await self._is_socket_alive():
                raise RuntimeError(
                    f"Another daemon is already running (socket: {self._socket_path})"
                )
            logger.info("Removing stale socket: %s", self._socket_path)
            path.unlink()

        # サーバー起動
        self._server = await asyncio.start_unix_server(
            self._handle_client, path=self._socket_path
        )

        # パーミッション設定と検証
        os.chmod(self._socket_path, 0o600)
        actual_mode = stat.S_IMODE(os.stat(self._socket_path).st_mode)
        if actual_mode != 0o600:
            path.unlink(missing_ok=True)
            raise RuntimeError(
                f"Socket permission verification failed: expected 0600, got {oct(actual_mode)}"
            )

        logger.info("IPC server listening on %s", self._socket_path)

    async def _is_socket_alive(self) -> bool:
        """既存ソケットに接続可能かテストする。"""
        try:
            reader, writer = await asyncio.open_unix_connection(self._socket_path)
            writer.close()
            await writer.wait_closed()
            return True
        except (ConnectionRefusedError, FileNotFoundError, OSError):
            return False

    def set_draining(self) -> None:
        """新規セッション受付を停止する。"""
        self._draining = True

    async def close(self) -> None:
        """IPC サーバーを停止し、ソケットファイルを削除する。"""
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        path = Path(self._socket_path)
        path.unlink(missing_ok=True)
        logger.info("IPC server closed, socket removed")

    async def _handle_client(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        """クライアント接続を処理する。"""
        try:
            # TASK-106: サイズ制限付き読み取り
            data = await reader.readuntil(b"\n")
            if not data:
                return
            if len(data) > MAX_IPC_MESSAGE_SIZE:
                await self._write_event(writer, {
                    "type": "error",
                    "message": f"Message too large: {len(data)} bytes (max: {MAX_IPC_MESSAGE_SIZE})",
                    "code": 1,
                })
                return

            request = json.loads(data.decode())
            action = request.get("action")

            if action == "start_session":
                await self._handle_start_session(request, writer)
            elif action == "session_output":
                await self._handle_session_output(request, writer)
            elif action == "list_sessions":
                await self._handle_list_sessions(request, writer)
            else:
                await self._write_event(writer, {
                    "type": "error",
                    "message": f"Unknown action: {action}",
                    "code": 1,
                })
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError) as e:
            logger.warning("IPC read error: %s", e)
            try:
                await self._write_event(writer, {
                    "type": "error",
                    "message": f"Read error: {e}",
                    "code": 1,
                })
            except Exception:
                pass
        except json.JSONDecodeError as e:
            logger.warning("IPC JSON decode error: %s", e)
            try:
                await self._write_event(writer, {
                    "type": "error",
                    "message": f"Invalid JSON: {e}",
                    "code": 1,
                })
            except Exception:
                pass
        except Exception as e:
            logger.exception("IPC handler error")
            try:
                await self._write_event(writer, {
                    "type": "error",
                    "message": str(e),
                    "code": 1,
                })
            except Exception:
                pass
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    async def _handle_start_session(
        self, request: dict, writer: asyncio.StreamWriter
    ) -> None:
        """セッション起動リクエストを処理する。"""
        if self._draining:
            await self._write_event(writer, {
                "type": "error",
                "message": "server is shutting down",
                "code": 1,
            })
            return

        # TASK-602: 入力バリデーション
        prompt = request.get("prompt", "")
        if not isinstance(prompt, str):
            await self._write_event(writer, {
                "type": "error",
                "message": "Invalid prompt: must be a string",
                "code": 1,
            })
            return

        prompt = prompt.strip()
        if not prompt:
            await self._write_event(writer, {
                "type": "error",
                "message": "Invalid prompt: must not be empty",
                "code": 1,
            })
            return

        if len(prompt) > MAX_PROMPT_LENGTH:
            await self._write_event(writer, {
                "type": "error",
                "message": f"Invalid prompt: too long ({len(prompt)} chars, max: {MAX_PROMPT_LENGTH})",
                "code": 1,
            })
            return

        cwd = request.get("cwd")
        if cwd is not None and not isinstance(cwd, str):
            await self._write_event(writer, {
                "type": "error",
                "message": "Invalid cwd: must be a string or null",
                "code": 1,
            })
            return

        session = await self._session_manager.start_session(prompt, cwd)

        # started イベントを送信
        await self._write_event(writer, {
            "type": "started",
            "session_id": session.session_id,
            "thread_ts": session.thread_ts,
        })

        # TASK-603: リアルタイムストリーミング（クライアント切断検知付き）
        async for event in self._session_manager.subscribe_events(session.session_id):
            try:
                await self._write_event(writer, event)
            except (ConnectionResetError, BrokenPipeError, OSError):
                # CLI クライアントが切断された
                logger.info(
                    "CLI client disconnected for session %s (session continues)",
                    session.session_id,
                )
                await self._session_manager.notify_client_disconnected(session.session_id)
                return
            if event["type"] in ("completed", "error"):
                break

    async def _handle_session_output(
        self, request: dict, writer: asyncio.StreamWriter
    ) -> None:
        """セッション出力のストリーミングを処理する。"""
        session_id = request.get("session_id", "")
        tail = request.get("tail", 100)

        # TASK-602: session_id バリデーション
        if not isinstance(session_id, str) or not session_id:
            await self._write_event(writer, {
                "type": "error",
                "message": "Invalid session_id: must be a non-empty string",
                "code": 1,
            })
            return

        # 過去バッファを送信
        lines = self._session_manager.get_output_tail(session_id, tail=tail)
        if lines:
            await self._write_event(writer, {
                "type": "output",
                "session_id": session_id,
                "text": "".join(lines),
            })

        # TASK-603: リアルタイムストリーミング（クライアント切断検知付き）
        async for event in self._session_manager.subscribe_events(session_id):
            try:
                await self._write_event(writer, event)
            except (ConnectionResetError, BrokenPipeError, OSError):
                logger.info(
                    "CLI client disconnected for session %s output stream",
                    session_id,
                )
                return
            if event["type"] in ("completed", "error"):
                break

    async def _handle_list_sessions(
        self, request: dict, writer: asyncio.StreamWriter
    ) -> None:
        """セッション一覧を返す。

        P5-005: include_history=True の場合は SQLite から履歴も含めて返す。
        """
        include_history = request.get("include_history", False)
        if include_history:
            sessions = self._session_manager.list_all_sessions()
        else:
            sessions = self._session_manager.list_sessions()
        line = json.dumps(sessions) + "\n"
        writer.write(line.encode())
        await writer.drain()

    async def _write_event(self, writer: asyncio.StreamWriter, event: dict) -> None:
        """JSON Lines 形式でイベントを書き込む。"""
        line = json.dumps(event) + "\n"
        writer.write(line.encode())
        await writer.drain()
