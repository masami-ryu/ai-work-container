"""スラッシュコマンドハンドラのテスト"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.audit import AuditLog
from src.config import Config
from src.handlers.slash_commands import (
    register_slash_command_handlers,
    _check_channel,
    _parse_claude_args,
    ParsedArgs,
)


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

    sm.start_session.assert_awaited_once_with(prompt="fix the bug", cwd=config.default_cwd)


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
    assert "--cwd" in call_kwargs["text"]
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


# ============================================================
# TASK-404: _parse_claude_args のパーステスト
# ============================================================


class TestParseCludeArgs:
    """TASK-301/404: _parse_claude_args のパース結果検証。"""

    def test_cwd_and_prompt(self):
        """TEST-005: --cwd /foo prompt → ("prompt", "/foo")。"""
        result = _parse_claude_args("--cwd /foo bar prompt")
        assert result == ParsedArgs(prompt="bar prompt", cwd="/foo")

    def test_prompt_only(self):
        """TEST-006: prompt のみ → cwd 未指定時は None。"""
        result = _parse_claude_args("prompt only")
        assert result == ParsedArgs(prompt="prompt only", cwd=None)

    def test_cwd_only_no_prompt(self):
        """--cwd /foo のみ → ("", "/foo")。"""
        result = _parse_claude_args("--cwd /foo")
        assert result == ParsedArgs(prompt="", cwd="/foo")

    def test_cwd_only_no_path_no_prompt(self):
        """--cwd のみ（path も prompt もなし）→ ("", None)。"""
        result = _parse_claude_args("--cwd")
        assert result == ParsedArgs(prompt="", cwd=None)

    def test_cwd_with_spaces_in_prompt(self):
        """--cwd /path prompt with spaces。"""
        result = _parse_claude_args("--cwd /workspaces/project fix all the bugs please")
        assert result.cwd == "/workspaces/project"
        assert result.prompt == "fix all the bugs please"

    def test_empty_text(self):
        """空文字列。"""
        result = _parse_claude_args("")
        assert result == ParsedArgs(prompt="", cwd=None)

    def test_whitespace_only(self):
        """空白のみ。"""
        result = _parse_claude_args("   ")
        assert result == ParsedArgs(prompt="", cwd=None)

    def test_cwd_not_at_start_is_prompt(self):
        """先頭以外の --cwd はプロンプトの一部として扱う。"""
        result = _parse_claude_args("please use --cwd /foo option")
        assert result.cwd is None
        assert result.prompt == "please use --cwd /foo option"


# ============================================================
# TASK-404: /claude --cwd のハンドラ統合テスト
# ============================================================


# TEST-007: 存在しないパスを --cwd に指定するとエラー
@pytest.mark.asyncio
async def test_claude_command_cwd_nonexistent_path():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    sm = MagicMock()
    sm.start_session = AsyncMock()

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "UAPPROVER01",
        "text": "--cwd /nonexistent/path/xyz fix bug",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude", command)

    call_kwargs = respond.call_args.kwargs
    assert "Directory not found" in call_kwargs["text"]
    assert call_kwargs["response_type"] == "ephemeral"

    await asyncio.sleep(0.1)
    sm.start_session.assert_not_awaited()


# TEST-012: ファイルパスを --cwd に指定するとエラー
@pytest.mark.asyncio
async def test_claude_command_cwd_file_path():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    sm = MagicMock()
    sm.start_session = AsyncMock()

    register_slash_command_handlers(app, sm, bot, config, audit)

    # 既存ファイルをパスとして指定
    command = {
        "user_id": "UAPPROVER01",
        "text": "--cwd /workspaces/ai-work-container/slack-bridge/pyproject.toml fix bug",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude", command)

    call_kwargs = respond.call_args.kwargs
    assert "Not a directory" in call_kwargs["text"]
    assert call_kwargs["response_type"] == "ephemeral"

    await asyncio.sleep(0.1)
    sm.start_session.assert_not_awaited()


# 有効な --cwd パスでセッション開始
@pytest.mark.asyncio
async def test_claude_command_cwd_valid_path():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    bot.post_ephemeral = AsyncMock()
    sm = MagicMock()
    sm.start_session = AsyncMock(return_value=MagicMock(session_id="cwd123"))

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "UAPPROVER01",
        "text": "--cwd /tmp fix the issue",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude", command)

    await asyncio.sleep(0.1)

    # /tmp は Path.resolve() で正規化されている
    sm.start_session.assert_awaited_once()
    call_kwargs = sm.start_session.call_args.kwargs
    assert call_kwargs["prompt"] == "fix the issue"
    resolved_cwd = call_kwargs["cwd"]
    assert Path(resolved_cwd).is_dir()


# TEST-013: ../を含むパスが正規化される
@pytest.mark.asyncio
async def test_claude_command_cwd_path_normalization():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    bot.post_ephemeral = AsyncMock()
    sm = MagicMock()
    sm.start_session = AsyncMock(return_value=MagicMock(session_id="norm123"))

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "UAPPROVER01",
        "text": "--cwd /tmp/../tmp do something",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude", command)

    await asyncio.sleep(0.1)

    sm.start_session.assert_awaited_once()
    call_kwargs = sm.start_session.call_args.kwargs
    # /tmp/../tmp は /tmp に正規化される
    assert call_kwargs["cwd"] == "/tmp"

    # 監査ログに cwd が記録される
    conn = audit._get_conn()
    row = conn.execute(
        "SELECT session_id FROM audit_log WHERE tool_name = '/claude' AND decision = 'accepted'",
    ).fetchone()
    assert row is not None
    assert "cwd=/tmp" in row[0]


# --cwd のみ（prompt なし）でエラー
@pytest.mark.asyncio
async def test_claude_command_cwd_only_no_prompt():
    config = _make_config()
    audit = AuditLog(":memory:")
    app = FakeApp()
    bot = MagicMock()
    sm = MagicMock()
    sm.start_session = AsyncMock()

    register_slash_command_handlers(app, sm, bot, config, audit)

    command = {
        "user_id": "UAPPROVER01",
        "text": "--cwd /tmp",
        "channel_name": "ai-approvals",
        "channel_id": "C123",
    }
    respond = await app.call_command("/claude", command)

    call_kwargs = respond.call_args.kwargs
    assert "Usage" in call_kwargs["text"]
    assert call_kwargs["response_type"] == "ephemeral"

    await asyncio.sleep(0.1)
    sm.start_session.assert_not_awaited()
