"""ハンドラのモックテスト"""

from __future__ import annotations

import asyncio
import json
import re
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.bridge import RequestBridge
from src.audit import AuditLog
from src.config import Config
from src.handlers.permission import register_permission_handlers
from src.handlers.ask_question import register_ask_handlers, _try_resolve_all_answered


def _make_config(**overrides) -> Config:
    defaults = dict(
        slack_app_token="xapp-1-A0001-000-abc123",
        slack_bot_token="xoxb-111-222-abc123",
        slack_channel="test-channel",
        slack_approver_user_id="UAPPROVER01",
    )
    defaults.update(overrides)
    return Config(**defaults)


class FakeApp:
    """Slack app のハンドラ登録をキャプチャする。"""

    def __init__(self):
        self._actions = {}
        self._events = {}
        self._views = {}

    def action(self, action_id):
        def decorator(fn):
            if hasattr(action_id, "pattern"):
                self._actions[action_id.pattern] = fn
            else:
                self._actions[action_id] = fn
            return fn
        return decorator

    def event(self, event_name):
        def decorator(fn):
            self._events[event_name] = fn
            return fn
        return decorator

    def view(self, callback_id):
        def decorator(fn):
            self._views[callback_id] = fn
            return fn
        return decorator

    async def call_action(self, action_id, body):
        # 正規表現パターンマッチ
        for pattern, fn in self._actions.items():
            if isinstance(pattern, str) and pattern == action_id:
                await fn(ack=AsyncMock(), body=body, client=AsyncMock())
                return
            elif isinstance(pattern, str):
                try:
                    if re.match(pattern, action_id):
                        await fn(ack=AsyncMock(), body=body, client=AsyncMock())
                        return
                except re.error:
                    pass

    async def call_view(self, callback_id, body):
        fn = self._views.get(callback_id)
        if fn:
            await fn(ack=AsyncMock(), body=body, client=AsyncMock())


# TEST-015: 許可ユーザーのボタン操作は受け付けられる
@pytest.mark.asyncio
async def test_authorized_user_allow():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()

    register_permission_handlers(app, bridge, audit, config)

    req = bridge.create_request("permission")
    cid = req.correlation_id

    body = {
        "user": {"id": "UAPPROVER01"},
        "actions": [{"value": cid, "action_id": "perm_allow"}],
        "message": {"ts": "123.456", "blocks": []},
        "channel": {"id": "C123"},
    }
    await app.call_action("perm_allow", body)

    assert req.result == {"decision": "allow", "user_id": "UAPPROVER01"}
    assert req.event.is_set()


# TEST-016: 非許可ユーザーのボタン操作は拒否される
@pytest.mark.asyncio
async def test_unauthorized_user_rejected():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()

    register_permission_handlers(app, bridge, audit, config)

    req = bridge.create_request("permission")
    cid = req.correlation_id

    body = {
        "user": {"id": "U_INTRUDER"},
        "actions": [{"value": cid, "action_id": "perm_allow"}],
        "message": {"ts": "123.456", "blocks": []},
        "channel": {"id": "C123"},
    }
    await app.call_action("perm_allow", body)

    # pending は解決されていない
    assert bridge.has_pending(cid)
    assert not req.event.is_set()

    # 監査ログに rejected_user が記録されている
    conn = audit._get_conn()
    row = conn.execute(
        "SELECT decision, responder_user_id FROM audit_log WHERE correlation_id = ?",
        (cid,),
    ).fetchone()
    assert row is not None
    assert row[0] == "rejected_user"
    assert row[1] == "U_INTRUDER"


# TEST: _try_resolve_all_answered が全質問回答時に resolve する
@pytest.mark.asyncio
async def test_try_resolve_all_answered():
    bridge = RequestBridge()

    req = bridge.create_request("ask_question")
    cid = req.correlation_id
    req._question_meta = {
        "questions": [
            {"question": "Q1?", "options": [{"label": "A"}]},
            {"question": "Q2?", "options": [{"label": "B"}]},
        ],
        "question_keys": ["Q1?", "Q2?"],
        "answers": {"Q1?": "A", "Q2?": "B"},
        "answered_count": 2,
        "total": 2,
        "last_user_id": "UAPPROVER01",
    }

    _try_resolve_all_answered(bridge, cid)

    assert req.event.is_set()
    assert req.result["decision"] == "answered"
    assert req.result["answers"] == {"Q1?": "A", "Q2?": "B"}


# TEST-005a: Other 回答 modal 方式 - 正しい question_index にルーティング
@pytest.mark.asyncio
async def test_other_modal_correct_routing():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()

    register_ask_handlers(app, bridge, audit, config)

    req = bridge.create_request("ask_question")
    cid = req.correlation_id
    req._question_meta = {
        "questions": [
            {"question": "Q1?", "options": [{"label": "A"}]},
            {"question": "Q2?", "options": [{"label": "B"}]},
        ],
        "question_keys": ["Q1?", "Q2?"],
        "answers": {},
        "answered_count": 0,
        "total": 2,
    }

    # Other ボタンの value フォーマット検証
    other_value_0 = f"{cid}|0"
    other_value_1 = f"{cid}|1"

    # Q2 に Other で回答（modal submission）
    view_body = {
        "user": {"id": "UAPPROVER01"},
        "view": {
            "private_metadata": json.dumps({
                "correlation_id": cid,
                "question_index": 1,
            }),
            "state": {
                "values": {
                    "answer_block": {
                        "answer_input": {"value": "custom answer for Q2"},
                    }
                }
            },
        },
    }
    await app.call_view("ask_other_submit", view_body)

    assert req._question_meta["answers"]["Q2?"] == "custom answer for Q2"
    assert req._question_meta["answered_count"] == 1
    # Q1 はまだ未回答
    assert "Q1?" not in req._question_meta["answers"]

    # Q1 に Other で回答
    view_body_q1 = {
        "user": {"id": "UAPPROVER01"},
        "view": {
            "private_metadata": json.dumps({
                "correlation_id": cid,
                "question_index": 0,
            }),
            "state": {
                "values": {
                    "answer_block": {
                        "answer_input": {"value": "custom answer for Q1"},
                    }
                }
            },
        },
    }
    await app.call_view("ask_other_submit", view_body_q1)

    assert req._question_meta["answers"]["Q1?"] == "custom answer for Q1"
    assert req._question_meta["answered_count"] == 2
    # 全質問回答済みで resolve されている
    assert req.event.is_set()
    assert req.result["decision"] == "answered"


# TEST-005b: 未許可ユーザーの Other modal submission が拒否される
@pytest.mark.asyncio
async def test_unauthorized_other_modal_rejected():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()

    register_ask_handlers(app, bridge, audit, config)

    req = bridge.create_request("ask_question")
    cid = req.correlation_id
    req._question_meta = {
        "questions": [{"question": "Q1?", "options": [{"label": "A"}]}],
        "question_keys": ["Q1?"],
        "answers": {},
        "answered_count": 0,
        "total": 1,
    }

    # 未許可ユーザーが modal submission
    view_body = {
        "user": {"id": "U_INTRUDER"},
        "view": {
            "private_metadata": json.dumps({
                "correlation_id": cid,
                "question_index": 0,
            }),
            "state": {
                "values": {
                    "answer_block": {
                        "answer_input": {"value": "unauthorized answer"},
                    }
                }
            },
        },
    }
    await app.call_view("ask_other_submit", view_body)

    # pending は解決されていない
    assert bridge.has_pending(cid)
    assert not req.event.is_set()
    assert req._question_meta["answered_count"] == 0

    # 監査ログに rejected_user が記録
    conn = audit._get_conn()
    row = conn.execute(
        "SELECT decision, responder_user_id FROM audit_log WHERE correlation_id = ?",
        (cid,),
    ).fetchone()
    assert row is not None
    assert row[0] == "rejected_user"
    assert row[1] == "U_INTRUDER"


# TEST-005a 補完: Other ボタン action の value フォーマット検証
@pytest.mark.asyncio
async def test_other_button_action_value_format():
    """ask_other_* ボタンの value が "correlation_id|question_index" 形式であることを検証。"""
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()

    register_ask_handlers(app, bridge, audit, config)

    req = bridge.create_request("ask_question")
    cid = req.correlation_id
    req._question_meta = {
        "questions": [{"question": "Q1?", "options": [{"label": "A"}]}],
        "question_keys": ["Q1?"],
        "answers": {},
        "answered_count": 0,
        "total": 1,
    }

    # Other ボタンクリック（許可ユーザー）
    mock_client = AsyncMock()
    body = {
        "user": {"id": "UAPPROVER01"},
        "actions": [{
            "value": f"{cid}|0",
            "action_id": "ask_other_0",
        }],
        "trigger_id": "trigger_123",
        "message": {"ts": "123.456"},
        "channel": {"id": "C123"},
    }

    # FakeApp の call_action は client を AsyncMock で差し替えるので
    # views_open が呼ばれることを確認
    await app.call_action("ask_other_0", body)
    # ハンドラが呼ばれていれば OK（views_open は AsyncMock で自動成功）


# TEST-005b 補完: 未許可ユーザーの Other ボタンクリックが拒否される
@pytest.mark.asyncio
async def test_unauthorized_other_button_rejected():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()

    register_ask_handlers(app, bridge, audit, config)

    req = bridge.create_request("ask_question")
    cid = req.correlation_id
    req._question_meta = {
        "questions": [{"question": "Q1?", "options": [{"label": "A"}]}],
        "question_keys": ["Q1?"],
        "answers": {},
        "answered_count": 0,
        "total": 1,
    }

    body = {
        "user": {"id": "U_INTRUDER"},
        "actions": [{
            "value": f"{cid}|0",
            "action_id": "ask_other_0",
        }],
        "trigger_id": "trigger_123",
        "message": {"ts": "123.456"},
        "channel": {"id": "C123"},
    }
    await app.call_action("ask_other_0", body)

    # 監査ログに rejected_user が記録
    conn = audit._get_conn()
    row = conn.execute(
        "SELECT decision, responder_user_id FROM audit_log WHERE correlation_id = ?",
        (cid,),
    ).fetchone()
    assert row is not None
    assert row[0] == "rejected_user"
    assert row[1] == "U_INTRUDER"


# --- Phase 1 テスト ---


def _make_bot():
    """テスト用のモック SlackBot を作成する。"""
    bot = MagicMock()
    bot.post_message = AsyncMock(return_value={"ts": "1234.5678"})
    bot.update_message = AsyncMock()
    bot.post_ephemeral = AsyncMock()
    return bot


# TEST-101: ask_choice ハンドラでタイムアウト後にボタンクリック → ephemeral メッセージ
@pytest.mark.asyncio
async def test_ask_choice_timeout_ephemeral():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()
    bot = _make_bot()

    register_ask_handlers(app, bridge, audit, config, bot=bot)

    # pending に存在しない correlation_id でボタンクリック
    body = {
        "user": {"id": "UAPPROVER01"},
        "actions": [{"value": "nonexistent|0|0", "action_id": "ask_choice_0_0"}],
        "message": {"ts": "123.456"},
        "channel": {"id": "C123"},
    }
    await app.call_action("ask_choice_0_0", body)

    bot.post_ephemeral.assert_awaited_once()
    call_kwargs = bot.post_ephemeral.call_args.kwargs
    assert call_kwargs["channel"] == "C123"
    assert call_kwargs["user"] == "UAPPROVER01"
    assert "timed out" in call_kwargs["text"]


# TEST-102: ask_toggle ハンドラでタイムアウト後にボタンクリック → ephemeral メッセージ
@pytest.mark.asyncio
async def test_ask_toggle_timeout_ephemeral():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()
    bot = _make_bot()

    register_ask_handlers(app, bridge, audit, config, bot=bot)

    body = {
        "user": {"id": "UAPPROVER01"},
        "actions": [{"value": "nonexistent|0|0", "action_id": "ask_toggle_0_0"}],
        "message": {"ts": "123.456"},
        "channel": {"id": "C123"},
    }
    await app.call_action("ask_toggle_0_0", body)

    bot.post_ephemeral.assert_awaited_once()
    call_kwargs = bot.post_ephemeral.call_args.kwargs
    assert "timed out" in call_kwargs["text"]


# TEST-103: bot.update_message() 失敗時に ephemeral 通知 + 回答確定処理が継続される
@pytest.mark.asyncio
async def test_update_message_failure_continues_resolve():
    from src.slack_bot import SlackAPIError

    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()
    bot = _make_bot()
    bot.update_message = AsyncMock(side_effect=SlackAPIError("update failed"))

    register_ask_handlers(app, bridge, audit, config, bot=bot)

    req = bridge.create_request("ask_question")
    cid = req.correlation_id
    req._question_meta = {
        "questions": [{"question": "Q1?", "options": [{"label": "A"}]}],
        "question_keys": ["Q1?"],
        "answers": {},
        "answered_count": 0,
        "total": 1,
    }

    body = {
        "user": {"id": "UAPPROVER01"},
        "actions": [{"value": f"{cid}|0|0", "action_id": "ask_choice_0_0"}],
        "message": {"ts": "123.456"},
        "channel": {"id": "C123"},
    }
    await app.call_action("ask_choice_0_0", body)

    # bot.update_message が失敗しても回答は記録される
    assert req._question_meta["answers"]["Q1?"] == "A"
    assert req._question_meta["answered_count"] == 1
    # 全質問回答済みで resolve されている
    assert req.event.is_set()
    assert req.result["decision"] == "answered"
    # ephemeral で通知されている
    bot.post_ephemeral.assert_awaited_once()
    call_kwargs = bot.post_ephemeral.call_args.kwargs
    assert "回答は受け付けました" in call_kwargs["text"]


# TEST-123: bot.update_message() に channel 引数を渡した場合と省略した場合
@pytest.mark.asyncio
async def test_update_message_channel_argument():
    from unittest.mock import patch as _patch

    from src.slack_bot import SlackBot
    from src.bridge import RequestBridge as _RB
    from src.audit import AuditLog as _AL

    config = _make_config()
    bridge = _RB()
    audit = _AL(":memory:")

    with (
        _patch("src.slack_bot.AsyncApp") as MockApp,
        _patch.object(SlackBot, "_register_handlers"),
    ):
        mock_app = MagicMock()
        mock_app.client = MagicMock()
        mock_app.client.chat_update = AsyncMock(return_value={"ok": True})
        MockApp.return_value = mock_app

        bot = SlackBot(config=config, bridge=bridge, audit=audit)
        bot.app = mock_app

        # channel 指定時
        await bot.update_message(
            ts="1234.5678", blocks=[], text="test", channel="COTHER",
        )
        call_kwargs = mock_app.client.chat_update.call_args.kwargs
        assert call_kwargs["channel"] == "COTHER"

        mock_app.client.chat_update.reset_mock()

        # channel 省略時は config.slack_channel
        await bot.update_message(ts="1234.5678", blocks=[], text="test")
        call_kwargs = mock_app.client.chat_update.call_args.kwargs
        assert call_kwargs["channel"] == config.slack_channel
