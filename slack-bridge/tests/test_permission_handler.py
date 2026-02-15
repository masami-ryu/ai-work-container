"""canUseTool 振り分けのユニットテスト (TEST-003, 004, 005, 015, 016)"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.bridge import RequestBridge
from src.audit import AuditLog
from src.config import Config
from src.permission_handler import create_permission_callback, AUTO_ALLOW_TOOLS


def _make_config(**overrides) -> Config:
    defaults = dict(
        slack_app_token="xapp-test",
        slack_bot_token="xoxb-test",
        slack_channel="test-channel",
        slack_approver_user_id="U_APPROVER",
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
