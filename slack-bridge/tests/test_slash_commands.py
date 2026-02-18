"""スラッシュコマンドハンドラのテスト"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.audit import AuditLog
from src.config import Config
from src.handlers.slash_commands import register_slash_command_handlers, _check_channel


def _make_config(**overrides) -> Config:
    defaults = dict(
        slack_app_token="xapp-1-A0001-000-abc123",
        slack_bot_token="xoxb-111-222-abc123",
        slack_channel="ai-approvals",
        slack_approver_user_id="UAPPROVER01",
    )
    defaults.update(overrides)
    return Config(**defaults)


class FakeApp:
    """Slack app のハンドラ登録をキャプチャする。"""

    def __init__(self):
        self._commands = {}

    def command(self, command_name):
        def decorator(fn):
            self._commands[command_name] = fn
            return fn
        return decorator

    def action(self, action_id):
        def decorator(fn):
            return fn
        return decorator

    def event(self, event_name):
        def decorator(fn):
            return fn
        return decorator

    def view(self, callback_id):
        def decorator(fn):
            return fn
        return decorator

    async def call_command(self, command_name, command_data):
        fn = self._commands.get(command_name)
        if fn:
            respond = AsyncMock()
            await fn(ack=AsyncMock(), command=command_data, respond=respond)
            return respond
        return None


# TEST-104: /claude でセッションが開始される
@pytest.mark.asyncio
async def test_claude_command_starts_session():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    bot.post_ephemeral = AsyncMock()
    sm = MagicMock()
    sm.start_session = AsyncMock(return_value=MagicMock(session_id="abc123"))

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "UAPPROVER01",
        "text": "fix the bug",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude", command)

    # 非同期タスクが実行されるまで待つ
    await asyncio.sleep(0.1)

    sm.start_session.assert_awaited_once_with(prompt="fix the bug", cwd=".")


# TEST-105: /claude (プロンプトなし) でエラーメッセージ
@pytest.mark.asyncio
async def test_claude_command_empty_prompt():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    sm = MagicMock()

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "UAPPROVER01",
        "text": "",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude", command)

    respond.assert_awaited_once()
    call_kwargs = respond.call_args.kwargs
    assert "Usage" in call_kwargs["text"]
    assert call_kwargs["response_type"] == "ephemeral"


# TEST-106: /claude-status でアクティブセッション一覧を返す
@pytest.mark.asyncio
async def test_claude_status_command():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    sm = MagicMock()
    sm.list_running_sessions.return_value = [
        {"session_id": "abc123", "prompt": "fix bug", "status": "running"},
    ]

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "UAPPROVER01",
        "text": "",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude-status", command)

    respond.assert_awaited_once()
    call_kwargs = respond.call_args.kwargs
    assert "abc123" in call_kwargs["text"]
    assert call_kwargs["response_type"] == "ephemeral"


# TEST-107: /claude-stop で停止
@pytest.mark.asyncio
async def test_claude_stop_command():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    sm = MagicMock()
    sm.stop_session = AsyncMock(return_value="Session 'abc123' has been stopped.")

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "UAPPROVER01",
        "text": "abc123",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude-stop", command)

    sm.stop_session.assert_awaited_once_with("abc123")
    call_kwargs = respond.call_args.kwargs
    assert "stopped" in call_kwargs["text"]


# TEST-108: /claude-stop (ID なし) でエラーメッセージ
@pytest.mark.asyncio
async def test_claude_stop_no_id():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    sm = MagicMock()

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "UAPPROVER01",
        "text": "",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude-stop", command)

    call_kwargs = respond.call_args.kwargs
    assert "Usage" in call_kwargs["text"]


# TEST-115: /claude-stop で存在しない session_id
@pytest.mark.asyncio
async def test_claude_stop_nonexistent_session():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    sm = MagicMock()
    sm.stop_session = AsyncMock(return_value="Session 'nonexistent' not found.")

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "UAPPROVER01",
        "text": "nonexistent",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude-stop", command)

    call_kwargs = respond.call_args.kwargs
    assert "not found" in call_kwargs["text"]


# TEST-118: set_session_manager() 未呼び出しで bot.start() が RuntimeError を送出
@pytest.mark.asyncio
async def test_start_without_session_manager():
    from src.slack_bot import SlackBot
    from src.bridge import RequestBridge

    config = _make_config()
    bridge = RequestBridge()
    audit = AuditLog(":memory:")

    with (
        patch("src.slack_bot.AsyncApp") as MockApp,
        patch.object(SlackBot, "_register_handlers"),
    ):
        mock_app = MagicMock()
        MockApp.return_value = mock_app
        bot = SlackBot(config=config, bridge=bridge, audit=audit)

        with pytest.raises(RuntimeError, match="set_session_manager"):
            await bot.start()


# TEST-120: /claude を設定チャンネル以外で実行 → エラー
@pytest.mark.asyncio
async def test_claude_command_wrong_channel():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    sm = MagicMock()
    sm.start_session = AsyncMock()

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "UAPPROVER01",
        "text": "fix bug",
        "channel_name": "other-channel",
        "channel_id": "COTHER",
    }
    respond = await app.call_command("/claude", command)

    call_kwargs = respond.call_args.kwargs
    assert "ai-approvals" in call_kwargs["text"]
    assert call_kwargs["response_type"] == "ephemeral"

    # セッションが開始されていないこと
    await asyncio.sleep(0.1)
    sm.start_session.assert_not_awaited()


# TEST-120 補完: config.slack_channel が ID 形式の場合
@pytest.mark.asyncio
async def test_claude_command_channel_id_match():
    config = _make_config(slack_channel="CTESTCHANNEL")
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    bot.post_ephemeral = AsyncMock()
    sm = MagicMock()
    sm.start_session = AsyncMock(return_value=MagicMock())

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "UAPPROVER01",
        "text": "fix bug",
        "channel_name": "some-channel",
        "channel_id": "CTESTCHANNEL",
    }
    respond = await app.call_command("/claude", command)

    await asyncio.sleep(0.1)
    sm.start_session.assert_awaited_once()


# TEST-120 補完: config.slack_channel が # プレフィックス付き
@pytest.mark.asyncio
async def test_claude_command_channel_hash_prefix():
    config = _make_config(slack_channel="#ai-approvals")
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    bot.post_ephemeral = AsyncMock()
    sm = MagicMock()
    sm.start_session = AsyncMock(return_value=MagicMock())

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "UAPPROVER01",
        "text": "fix bug",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude", command)

    await asyncio.sleep(0.1)
    sm.start_session.assert_awaited_once()


# TEST-125: /claude でセッション起動失敗時にエラー通知
@pytest.mark.asyncio
async def test_claude_command_session_failure():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    bot.post_ephemeral = AsyncMock()
    sm = MagicMock()
    sm.start_session = AsyncMock(side_effect=RuntimeError("SDK error"))

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "UAPPROVER01",
        "text": "fix bug",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude", command)

    await asyncio.sleep(0.1)
    bot.post_ephemeral.assert_awaited_once()
    call_kwargs = bot.post_ephemeral.call_args.kwargs
    assert "Failed" in call_kwargs["text"]


# TEST-126: 未承認ユーザーが /claude を実行 → 拒否
@pytest.mark.asyncio
async def test_claude_command_unauthorized_user():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    sm = MagicMock()
    sm.start_session = AsyncMock()

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "U_INTRUDER",
        "text": "fix bug",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude", command)

    call_kwargs = respond.call_args.kwargs
    assert "not authorized" in call_kwargs["text"]

    # 監査ログに rejected_user が記録
    conn = audit._get_conn()
    row = conn.execute(
        "SELECT decision, responder_user_id FROM audit_log WHERE decision = 'rejected_user'",
    ).fetchone()
    assert row is not None
    assert row[1] == "U_INTRUDER"

    # セッションが開始されていないこと
    await asyncio.sleep(0.1)
    sm.start_session.assert_not_awaited()


# TEST-127: 未承認ユーザーが /claude-status を実行 → 拒否
@pytest.mark.asyncio
async def test_claude_status_unauthorized_user():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    sm = MagicMock()

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "U_INTRUDER",
        "text": "",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude-status", command)

    call_kwargs = respond.call_args.kwargs
    assert "not authorized" in call_kwargs["text"]

    conn = audit._get_conn()
    row = conn.execute(
        "SELECT decision FROM audit_log WHERE decision = 'rejected_user' AND tool_name = '/claude-status'",
    ).fetchone()
    assert row is not None


# TEST-128: 未承認ユーザーが /claude-stop を実行 → 拒否
@pytest.mark.asyncio
async def test_claude_stop_unauthorized_user():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    sm = MagicMock()

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "U_INTRUDER",
        "text": "abc123",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude-stop", command)

    call_kwargs = respond.call_args.kwargs
    assert "not authorized" in call_kwargs["text"]

    conn = audit._get_conn()
    row = conn.execute(
        "SELECT decision FROM audit_log WHERE decision = 'rejected_user' AND tool_name = '/claude-stop'",
    ).fetchone()
    assert row is not None


# TEST-130: set_session_manager() を2回呼び出すと RuntimeError
@pytest.mark.asyncio
async def test_set_session_manager_twice_raises():
    from src.slack_bot import SlackBot
    from src.bridge import RequestBridge

    config = _make_config()
    bridge = RequestBridge()
    audit = AuditLog(":memory:")

    with (
        patch("src.slack_bot.AsyncApp") as MockApp,
        patch.object(SlackBot, "_register_handlers"),
    ):
        mock_app = MagicMock()
        MockApp.return_value = mock_app
        bot = SlackBot(config=config, bridge=bridge, audit=audit)

        mock_sm = MagicMock()
        with patch.object(bot, "_register_session_handlers"):
            bot.set_session_manager(mock_sm)

            with pytest.raises(RuntimeError, match="already been called"):
                bot.set_session_manager(mock_sm)
