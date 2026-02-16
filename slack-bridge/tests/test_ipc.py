"""IPC サーバーのユニットテスト"""

from __future__ import annotations

import asyncio
import json
import os
import stat
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.ipc import IPCServer, get_socket_path, MAX_PROMPT_LENGTH
from src.session import SessionManager, Session
from src.bridge import RequestBridge
from src.audit import AuditLog
from src.config import Config


def _make_config(**overrides) -> Config:
    defaults = dict(
        slack_app_token="xapp-1-A0001-000-abc123",
        slack_bot_token="xoxb-111-222-abc123",
        slack_channel="test-channel",
        slack_approver_user_id="UAPPROVER01",
    )
    defaults.update(overrides)
    return Config(**defaults)


def _make_bot():
    bot = MagicMock()
    bot.post_message = AsyncMock(return_value={"ts": "1234.5678"})
    bot.update_message = AsyncMock()
    return bot


# TEST-014: ソケットパーミッション検証
@pytest.mark.asyncio
async def test_socket_permission():
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")
        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        server = IPCServer(session_manager=sm, socket_path=sock_path)
        await server.start()

        # ソケットファイルのモードが 0o600
        actual_mode = stat.S_IMODE(os.stat(sock_path).st_mode)
        assert actual_mode == 0o600

        await server.close()


# TEST-015: stale socket 回復
@pytest.mark.asyncio
async def test_stale_socket_recovery():
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")

        # stale socket を作成（接続不能なファイル）
        with open(sock_path, "w") as f:
            f.write("")

        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        server = IPCServer(session_manager=sm, socket_path=sock_path)
        await server.start()

        # stale socket が削除され、新しいソケットが作成された
        assert os.path.exists(sock_path)

        await server.close()


# TEST-015: 稼働中デーモン検知
@pytest.mark.asyncio
async def test_running_daemon_detection():
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")
        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        # 1つ目のサーバーを起動
        server1 = IPCServer(session_manager=sm, socket_path=sock_path)
        await server1.start()

        # 2つ目のサーバーは起動失敗する
        server2 = IPCServer(session_manager=sm, socket_path=sock_path)
        with pytest.raises(RuntimeError, match="Another daemon is already running"):
            await server2.start()

        await server1.close()


# TEST-007: IPC 経由でのセッション起動
@pytest.mark.asyncio
async def test_ipc_start_session():
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")
        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        server = IPCServer(session_manager=sm, socket_path=sock_path)
        await server.start()

        with patch("src.session.ClaudeSDKClient"):
            reader, writer = await asyncio.open_unix_connection(sock_path)

            request = {"action": "start_session", "prompt": "test", "cwd": "/tmp"}
            writer.write((json.dumps(request) + "\n").encode())
            await writer.drain()

            # started イベントを受信
            line = await asyncio.wait_for(reader.readline(), timeout=2.0)
            event = json.loads(line.decode())
            assert event["type"] == "started"
            assert "session_id" in event

            writer.close()
            await writer.wait_closed()

        await sm.shutdown()
        await server.close()


# TEST-012: IPC 経由のセッション一覧取得
@pytest.mark.asyncio
async def test_ipc_list_sessions():
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")
        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        server = IPCServer(session_manager=sm, socket_path=sock_path)
        await server.start()

        reader, writer = await asyncio.open_unix_connection(sock_path)

        request = {"action": "list_sessions"}
        writer.write((json.dumps(request) + "\n").encode())
        await writer.drain()

        line = await asyncio.wait_for(reader.readline(), timeout=2.0)
        sessions = json.loads(line.decode())
        assert isinstance(sessions, list)

        writer.close()
        await writer.wait_closed()

        await server.close()


# TEST-013: draining 状態での新規セッション拒否
@pytest.mark.asyncio
async def test_draining_rejects_new_session():
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")
        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        server = IPCServer(session_manager=sm, socket_path=sock_path)
        await server.start()
        server.set_draining()

        reader, writer = await asyncio.open_unix_connection(sock_path)

        request = {"action": "start_session", "prompt": "test"}
        writer.write((json.dumps(request) + "\n").encode())
        await writer.drain()

        line = await asyncio.wait_for(reader.readline(), timeout=2.0)
        event = json.loads(line.decode())
        assert event["type"] == "error"
        assert "shutting down" in event["message"]

        writer.close()
        await writer.wait_closed()

        await server.close()


# ソケットパス取得のテスト
def test_get_socket_path_default():
    with patch.dict(os.environ, {}, clear=True):
        # XDG_RUNTIME_DIR と SB_SOCK が未設定の場合
        os.environ.pop("SB_SOCK", None)
        os.environ.pop("XDG_RUNTIME_DIR", None)
        path = get_socket_path()
        assert path == "/tmp/sb.sock"


def test_get_socket_path_xdg():
    with patch.dict(os.environ, {"XDG_RUNTIME_DIR": "/run/user/1000"}, clear=False):
        os.environ.pop("SB_SOCK", None)
        path = get_socket_path()
        assert path == "/run/user/1000/sb.sock"


def test_get_socket_path_env():
    with patch.dict(os.environ, {"SB_SOCK": "/custom/path.sock"}, clear=False):
        path = get_socket_path()
        assert path == "/custom/path.sock"


# --- TASK-602: IPC 入力バリデーション ---


@pytest.mark.asyncio
async def test_ipc_empty_prompt_rejected():
    """TASK-602: 空の prompt でセッション起動するとエラーが返る。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")
        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        server = IPCServer(session_manager=sm, socket_path=sock_path)
        await server.start()

        reader, writer = await asyncio.open_unix_connection(sock_path)

        request = {"action": "start_session", "prompt": ""}
        writer.write((json.dumps(request) + "\n").encode())
        await writer.drain()

        line = await asyncio.wait_for(reader.readline(), timeout=2.0)
        event = json.loads(line.decode())
        assert event["type"] == "error"
        assert "empty" in event["message"].lower()

        writer.close()
        await writer.wait_closed()
        await server.close()


@pytest.mark.asyncio
async def test_ipc_whitespace_only_prompt_rejected():
    """TASK-602: 空白のみの prompt はエラー。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")
        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        server = IPCServer(session_manager=sm, socket_path=sock_path)
        await server.start()

        reader, writer = await asyncio.open_unix_connection(sock_path)

        request = {"action": "start_session", "prompt": "   \n\t  "}
        writer.write((json.dumps(request) + "\n").encode())
        await writer.drain()

        line = await asyncio.wait_for(reader.readline(), timeout=2.0)
        event = json.loads(line.decode())
        assert event["type"] == "error"
        assert "empty" in event["message"].lower()

        writer.close()
        await writer.wait_closed()
        await server.close()


@pytest.mark.asyncio
async def test_ipc_prompt_too_long_rejected():
    """TASK-602: 長すぎる prompt はエラーが返る。

    asyncio StreamReader のデフォルトリミット (64KB) を超えるメッセージは
    LimitOverrunError で捕捉され "Read error" が返る。
    MAX_PROMPT_LENGTH (100K) 以内でもメッセージ全体が 64KB を超えれば
    StreamReader レベルでブロックされる。
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")
        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        server = IPCServer(session_manager=sm, socket_path=sock_path)
        await server.start()

        reader, writer = await asyncio.open_unix_connection(sock_path)

        # StreamReader のデフォルトリミットを超える大きなメッセージ
        long_prompt = "x" * (MAX_PROMPT_LENGTH + 1)
        request = {"action": "start_session", "prompt": long_prompt}
        writer.write((json.dumps(request) + "\n").encode())
        await writer.drain()

        line = await asyncio.wait_for(reader.readline(), timeout=2.0)
        event = json.loads(line.decode())
        assert event["type"] == "error"
        # StreamReader のリミットを超えるため Read error になる
        # （prompt 長チェック前に StreamReader がエラーを発生させる）

        writer.close()
        await writer.wait_closed()
        await server.close()


@pytest.mark.asyncio
async def test_ipc_prompt_length_validation():
    """TASK-602: MAX_PROMPT_LENGTH バリデーション（StreamReader リミット内で検証）。

    IPCServer の StreamReader リミットを拡大して、prompt 長バリデーションの動作を検証する。
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")
        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        server = IPCServer(session_manager=sm, socket_path=sock_path)

        # StreamReader のリミットを一時的に変更して起動
        original_start = server.start

        async def start_with_high_limit():
            """高い StreamReader リミットでサーバーを起動する。"""
            from pathlib import Path
            path = Path(server._socket_path)
            if path.exists():
                if await server._is_socket_alive():
                    raise RuntimeError(f"Another daemon is already running")
                path.unlink()
            server._server = await asyncio.start_unix_server(
                server._handle_client, path=server._socket_path, limit=1024 * 1024 * 2
            )
            os.chmod(server._socket_path, 0o600)

        await start_with_high_limit()

        reader, writer = await asyncio.open_unix_connection(sock_path, limit=1024 * 1024 * 2)

        # MAX_PROMPT_LENGTH + 1 文字の prompt
        long_prompt = "a" * (MAX_PROMPT_LENGTH + 1)
        request = {"action": "start_session", "prompt": long_prompt}
        writer.write((json.dumps(request) + "\n").encode())
        await writer.drain()

        line = await asyncio.wait_for(reader.readline(), timeout=5.0)
        event = json.loads(line.decode())
        assert event["type"] == "error"
        assert "too long" in event["message"].lower()

        writer.close()
        await writer.wait_closed()
        await server.close()


@pytest.mark.asyncio
async def test_ipc_non_string_prompt_rejected():
    """TASK-602: prompt が文字列でない場合はエラー。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")
        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        server = IPCServer(session_manager=sm, socket_path=sock_path)
        await server.start()

        reader, writer = await asyncio.open_unix_connection(sock_path)

        request = {"action": "start_session", "prompt": 12345}
        writer.write((json.dumps(request) + "\n").encode())
        await writer.drain()

        line = await asyncio.wait_for(reader.readline(), timeout=2.0)
        event = json.loads(line.decode())
        assert event["type"] == "error"
        assert "string" in event["message"].lower()

        writer.close()
        await writer.wait_closed()
        await server.close()


@pytest.mark.asyncio
async def test_ipc_invalid_cwd_type_rejected():
    """TASK-602: cwd が文字列でない場合はエラー。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")
        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        server = IPCServer(session_manager=sm, socket_path=sock_path)
        await server.start()

        reader, writer = await asyncio.open_unix_connection(sock_path)

        request = {"action": "start_session", "prompt": "hello", "cwd": 123}
        writer.write((json.dumps(request) + "\n").encode())
        await writer.drain()

        line = await asyncio.wait_for(reader.readline(), timeout=2.0)
        event = json.loads(line.decode())
        assert event["type"] == "error"
        assert "cwd" in event["message"].lower()

        writer.close()
        await writer.wait_closed()
        await server.close()


@pytest.mark.asyncio
async def test_ipc_invalid_json_returns_error():
    """TASK-602: 不正 JSON に対して具体的なエラーメッセージが返る。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")
        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        server = IPCServer(session_manager=sm, socket_path=sock_path)
        await server.start()

        reader, writer = await asyncio.open_unix_connection(sock_path)

        writer.write(b"this is not json\n")
        await writer.drain()

        line = await asyncio.wait_for(reader.readline(), timeout=2.0)
        event = json.loads(line.decode())
        assert event["type"] == "error"
        assert "Invalid JSON" in event["message"]

        writer.close()
        await writer.wait_closed()
        await server.close()


@pytest.mark.asyncio
async def test_ipc_unknown_action_returns_error():
    """TASK-602: 不明な action に対してエラーが返る。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")
        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        server = IPCServer(session_manager=sm, socket_path=sock_path)
        await server.start()

        reader, writer = await asyncio.open_unix_connection(sock_path)

        request = {"action": "nonexistent_action"}
        writer.write((json.dumps(request) + "\n").encode())
        await writer.drain()

        line = await asyncio.wait_for(reader.readline(), timeout=2.0)
        event = json.loads(line.decode())
        assert event["type"] == "error"
        assert "Unknown action" in event["message"]

        writer.close()
        await writer.wait_closed()
        await server.close()


@pytest.mark.asyncio
async def test_ipc_empty_session_id_rejected():
    """TASK-602: session_output で空の session_id はエラー。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        sock_path = os.path.join(tmpdir, "test.sock")
        bridge = RequestBridge()
        audit = AuditLog(":memory:")
        config = _make_config()
        bot = _make_bot()
        sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

        server = IPCServer(session_manager=sm, socket_path=sock_path)
        await server.start()

        reader, writer = await asyncio.open_unix_connection(sock_path)

        request = {"action": "session_output", "session_id": ""}
        writer.write((json.dumps(request) + "\n").encode())
        await writer.drain()

        line = await asyncio.wait_for(reader.readline(), timeout=2.0)
        event = json.loads(line.decode())
        assert event["type"] == "error"
        assert "session_id" in event["message"].lower()

        writer.close()
        await writer.wait_closed()
        await server.close()


# --- TASK-603: CLI クライアント切断通知 ---


@pytest.mark.asyncio
async def test_notify_client_disconnected():
    """TASK-603: CLI 切断時にスレッドに通知が投稿される。"""
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    bot = _make_bot()
    sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

    # セッションを手動で追加
    session = Session(session_id="disc-01", prompt="test", cwd=".", thread_ts="999.111")
    sm._sessions["disc-01"] = session

    await sm.notify_client_disconnected("disc-01")

    bot.post_message.assert_called_once()
    call_kwargs = bot.post_message.call_args.kwargs
    assert call_kwargs["thread_ts"] == "999.111"
    assert "CLI" in call_kwargs["text"] or "disconnected" in call_kwargs["text"]


@pytest.mark.asyncio
async def test_notify_client_disconnected_unknown_session():
    """TASK-603: 存在しないセッションIDでは何もしない。"""
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    bot = _make_bot()
    sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

    # 存在しないセッションID — エラーにならない
    await sm.notify_client_disconnected("nonexistent")
    bot.post_message.assert_not_called()


@pytest.mark.asyncio
async def test_notify_client_disconnected_api_failure():
    """TASK-603: Slack API 失敗時でも例外が伝播しない。"""
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    bot = _make_bot()
    bot.post_message = AsyncMock(side_effect=Exception("Slack API down"))
    sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

    session = Session(session_id="disc-02", prompt="test", cwd=".", thread_ts="999.222")
    sm._sessions["disc-02"] = session

    # 例外が伝播しないことを確認
    await sm.notify_client_disconnected("disc-02")
