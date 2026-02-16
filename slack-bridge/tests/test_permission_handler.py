"""canUseTool 振り分けのユニットテスト (TEST-003, 004, 005, 015, 016, TASK-502)"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.bridge import RequestBridge
from src.audit import AuditLog
from src.config import Config
from src.permission_handler import create_permission_callback, AUTO_ALLOW_TOOLS
from src.session import Session, ToolStats


def _make_config(**overrides) -> Config:
    defaults = dict(
        slack_app_token="xapp-1-A0001-000-abc123",
        slack_bot_token="xoxb-111-222-abc123",
        slack_channel="test-channel",
        slack_approver_user_id="UAPPROVER01",
    )
    defaults.update(overrides)
    return Config(**defaults)


# TEST-003: Read ツールは自動許可
@pytest.mark.asyncio
async def test_auto_allow_read():
    bridge = RequestBridge()
    bot = MagicMock()
    config = _make_config()
    audit = AuditLog(":memory:")

    callback = create_permission_callback(bridge, bot, config, audit)
    result = await callback("Read", {"file_path": "/tmp/test"}, None)

    assert result.behavior == "allow"
    assert result.updated_input == {"file_path": "/tmp/test"}


# TEST-003 拡張: 全 AUTO_ALLOW_TOOLS が自動許可
@pytest.mark.asyncio
@pytest.mark.parametrize("tool_name", list(AUTO_ALLOW_TOOLS))
async def test_auto_allow_all(tool_name):
    bridge = RequestBridge()
    bot = MagicMock()
    config = _make_config()
    audit = AuditLog(":memory:")

    callback = create_permission_callback(bridge, bot, config, audit)
    result = await callback(tool_name, {}, None)
    assert result.behavior == "allow"


# TEST-004: AskUserQuestion の振り分け
@pytest.mark.asyncio
async def test_ask_question_dispatch():
    bridge = RequestBridge()
    bot = MagicMock()
    config = _make_config()
    audit = AuditLog(":memory:")

    callback = create_permission_callback(bridge, bot, config, audit)

    # handle_ask_question はローカルインポートされるため、モジュール側をパッチ
    with patch(
        "src.handlers.ask_question.handle_ask_question",
        new_callable=AsyncMock,
        return_value={"decision": "answered", "answers": {"Q": "A"}},
    ):
        result = await callback("AskUserQuestion", {"questions": []}, None)
        assert result.behavior == "allow"


# TEST-005: Bash ツールの振り分け
@pytest.mark.asyncio
async def test_bash_dispatch():
    bridge = RequestBridge()
    bot = MagicMock()
    config = _make_config()
    audit = AuditLog(":memory:")

    callback = create_permission_callback(bridge, bot, config, audit)

    with patch(
        "src.handlers.permission.handle_permission",
        new_callable=AsyncMock,
        return_value={"decision": "allow", "user_id": "U_APPROVER"},
    ):
        result = await callback("Bash", {"command": "ls"}, None)
        assert result.behavior == "allow"


# TEST-005b: Bash deny
@pytest.mark.asyncio
async def test_bash_deny():
    bridge = RequestBridge()
    bot = MagicMock()
    config = _make_config()
    audit = AuditLog(":memory:")

    callback = create_permission_callback(bridge, bot, config, audit)

    with patch(
        "src.handlers.permission.handle_permission",
        new_callable=AsyncMock,
        return_value={"decision": "deny", "user_id": "U_APPROVER"},
    ):
        result = await callback("Bash", {"command": "rm -rf /"}, None)
        assert result.behavior == "deny"


# --- TASK-502: 自動許可ツールの監査ログ記録 ---


@pytest.mark.asyncio
@pytest.mark.parametrize("tool_name", list(AUTO_ALLOW_TOOLS))
async def test_auto_allow_records_audit_log(tool_name):
    """AUTO_ALLOW_TOOLS は自動許可し、decision='auto_allow' で監査ログを記録する。"""
    bridge = RequestBridge()
    bot = MagicMock()
    config = _make_config()
    audit = MagicMock(spec=AuditLog)

    callback = create_permission_callback(bridge, bot, config, audit)
    result = await callback(tool_name, {}, None)

    assert result.behavior == "allow"
    audit.record.assert_called_once_with(
        correlation_id="auto",
        request_type="permission",
        tool_name=tool_name,
        decision="auto_allow",
    )


# --- TASK-502: session.stats が auto_allow で更新される ---


@pytest.mark.asyncio
@pytest.mark.parametrize("tool_name", ["Read", "Glob", "Grep"])
async def test_auto_allow_updates_session_stats(tool_name):
    """session が渡されている場合、auto_allow が session.stats に記録される。"""
    bridge = RequestBridge()
    bot = MagicMock()
    config = _make_config()
    audit = MagicMock(spec=AuditLog)
    session = Session(session_id="test-sess", prompt="test", cwd=".")

    callback = create_permission_callback(bridge, bot, config, audit, session=session)
    result = await callback(tool_name, {}, None)

    assert result.behavior == "allow"
    assert session.stats.total_uses == 1
    assert session.stats.auto_allowed == 1
    assert session.stats.last_tool == tool_name
    assert session.stats.tool_counts[tool_name] == 1


# --- TASK-502: session.stats が permission allow/deny で更新される ---


@pytest.mark.asyncio
async def test_permission_allow_updates_session_stats():
    """権限確認で allow された場合、session.stats が更新される。"""
    bridge = RequestBridge()
    bot = MagicMock()
    config = _make_config()
    audit = MagicMock(spec=AuditLog)
    session = Session(session_id="test-sess", prompt="test", cwd=".")

    callback = create_permission_callback(bridge, bot, config, audit, session=session)

    with patch(
        "src.handlers.permission.handle_permission",
        new_callable=AsyncMock,
        return_value={"decision": "allow", "user_id": "U_APPROVER"},
    ):
        result = await callback("Bash", {"command": "echo hello"}, None)

    assert result.behavior == "allow"
    assert session.stats.total_uses == 1
    assert session.stats.allowed == 1
    assert session.stats.last_tool == "Bash"


@pytest.mark.asyncio
async def test_permission_deny_updates_session_stats():
    """権限確認で deny された場合、session.stats が更新される。"""
    bridge = RequestBridge()
    bot = MagicMock()
    config = _make_config()
    audit = MagicMock(spec=AuditLog)
    session = Session(session_id="test-sess", prompt="test", cwd=".")

    callback = create_permission_callback(bridge, bot, config, audit, session=session)

    with patch(
        "src.handlers.permission.handle_permission",
        new_callable=AsyncMock,
        return_value={"decision": "deny", "user_id": "U_APPROVER"},
    ):
        result = await callback("Bash", {"command": "rm -rf /"}, None)

    assert result.behavior == "deny"
    assert session.stats.total_uses == 1
    assert session.stats.denied == 1
    assert session.stats.last_tool == "Bash"


# --- TASK-502: Write/Edit ツールで file_path が changed_files に追跡される ---


@pytest.mark.asyncio
async def test_write_tool_tracks_changed_files():
    """Write ツールで allow された場合、file_path が changed_files に追跡される。"""
    bridge = RequestBridge()
    bot = MagicMock()
    config = _make_config()
    audit = MagicMock(spec=AuditLog)
    session = Session(session_id="test-sess", prompt="test", cwd=".")

    callback = create_permission_callback(bridge, bot, config, audit, session=session)

    with patch(
        "src.handlers.permission.handle_permission",
        new_callable=AsyncMock,
        return_value={"decision": "allow", "user_id": "U_APPROVER"},
    ):
        result = await callback("Write", {"file_path": "/tmp/new_file.py", "content": "hello"}, None)

    assert result.behavior == "allow"
    assert "/tmp/new_file.py" in session.stats.changed_files


# --- TASK-502: TodoWrite で todo progress 通知が送信される ---


@pytest.mark.asyncio
async def test_todowrite_triggers_todo_progress_notification():
    """TodoWrite 実行時に session が設定されていれば Slack に進捗通知が送信される。"""
    bridge = RequestBridge()
    bot = MagicMock()
    bot.post_message = AsyncMock(return_value={"ts": "9999.0001"})
    bot.update_message = AsyncMock()
    config = _make_config()
    audit = MagicMock(spec=AuditLog)
    session = Session(session_id="todo-sess", prompt="test", cwd=".")

    callback = create_permission_callback(
        bridge, bot, config, audit, thread_ts="1234.5678", session=session
    )

    todos_input = {
        "todos": [
            {"content": "Task A", "status": "completed", "activeForm": "Doing A"},
            {"content": "Task B", "status": "in_progress", "activeForm": "Doing B"},
        ]
    }

    with patch("src.permission_handler.time") as mock_time:
        # _todo_last_notify_time は 0 なので、now=100 であれば間隔チェックを通過する
        mock_time.time.return_value = 100.0

        result = await callback("TodoWrite", todos_input, None)

    assert result.behavior == "allow"
    # bot.post_message が呼ばれた（セッション開始メッセージとは別に進捗通知）
    bot.post_message.assert_called()
    # 通知メッセージの text にセッションIDが含まれる
    call_kwargs = bot.post_message.call_args
    assert "todo-sess" in call_kwargs.kwargs.get("text", "") or "todo-sess" in str(call_kwargs)


@pytest.mark.asyncio
async def test_todowrite_no_notification_without_session():
    """TodoWrite 実行時に session が None の場合は通知が送信されない。"""
    bridge = RequestBridge()
    bot = MagicMock()
    bot.post_message = AsyncMock()
    config = _make_config()
    audit = MagicMock(spec=AuditLog)

    callback = create_permission_callback(bridge, bot, config, audit, session=None)

    todos_input = {
        "todos": [
            {"content": "Task A", "status": "in_progress", "activeForm": "Doing A"},
        ]
    }

    result = await callback("TodoWrite", todos_input, None)

    assert result.behavior == "allow"
    # session=None の場合は post_message が呼ばれない
    bot.post_message.assert_not_called()
