"""スレッド返信ハンドラのテスト"""

from __future__ import annotations

import re
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.bridge import RequestBridge
from src.audit import AuditLog
from src.config import Config
from src.session import SessionManager
from src.handlers.thread_reply import register_thread_reply_handler


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
        self._events = {}

    def action(self, action_id):
        def decorator(fn):
            return fn
        return decorator

    def command(self, name):
        def decorator(fn):
            return fn
        return decorator

    def event(self, event_name):
        def decorator(fn):
            self._events[event_name] = fn
            return fn
        return decorator

    def view(self, callback_id):
        def decorator(fn):
            return fn
        return decorator

    async def call_event(self, event_name, event_data):
        fn = self._events.get(event_name)
        if fn:
            await fn(event=event_data, say=AsyncMock())


def _make_bot():
    bot = MagicMock()
    bot.post_message = AsyncMock(return_value={"ts": "1234.5678"})
    bot.update_message = AsyncMock()
    bot.post_ephemeral = AsyncMock()
    return bot


def _make_session_manager():
    sm = MagicMock()
    sm.get_pending_questions_for_thread = MagicMock(return_value=[])
    sm.register_thread_question = MagicMock()
    sm.unregister_thread_question = MagicMock()
    sm.unregister_thread_questions = MagicMock()
    return sm


# TEST-109: スレッド返信で pending 質問に回答が記録される
@pytest.mark.asyncio
async def test_thread_reply_answers_pending_question():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()
    bot = _make_bot()
    sm = _make_session_manager()

    register_thread_reply_handler(app, sm, bridge, bot, config, audit)

    # pending request を作成
    req = bridge.create_request("ask_question")
    cid = req.correlation_id
    req._question_meta = {
        "questions": [{"question": "Q1?", "options": [{"label": "A"}]}],
        "question_keys": ["Q1?"],
        "answers": {},
        "answered_count": 0,
        "total": 1,
    }

    sm.get_pending_questions_for_thread.return_value = [
        {"cid": cid, "question_index": 0, "message_ts": "msg_ts_1"},
    ]

    event = {
        "user": "UAPPROVER01",
        "text": "My thread reply answer",
        "thread_ts": "thread_123",
    }
    await app.call_event("message", event)

    # 回答が記録される
    assert req._question_meta["answers"]["Q1?"] == "My thread reply answer"
    assert req._question_meta["answered_count"] == 1
    # resolve されている
    assert req.event.is_set()
    assert req.result["decision"] == "answered"
    # メッセージ更新が呼ばれる
    bot.update_message.assert_awaited_once()
    # 単一解放が呼ばれる
    sm.unregister_thread_question.assert_called_once_with("thread_123", cid, 0)
    # 監査ログに thread_reply が記録される
    conn = audit._get_conn()
    row = conn.execute(
        "SELECT decision FROM audit_log WHERE decision = 'thread_reply'",
    ).fetchone()
    assert row is not None


# TEST-110: pending 質問なしのスレッド返信 → 無視
@pytest.mark.asyncio
async def test_thread_reply_no_pending_ignored():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()
    bot = _make_bot()
    sm = _make_session_manager()
    sm.get_pending_questions_for_thread.return_value = []

    register_thread_reply_handler(app, sm, bridge, bot, config, audit)

    event = {
        "user": "UAPPROVER01",
        "text": "Some reply",
        "thread_ts": "thread_123",
    }
    await app.call_event("message", event)

    bot.update_message.assert_not_awaited()


# TEST-111: subtype 存在イベントのスレッド返信 → 無視
@pytest.mark.asyncio
async def test_thread_reply_subtype_ignored():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()
    bot = _make_bot()
    sm = _make_session_manager()

    register_thread_reply_handler(app, sm, bridge, bot, config, audit)

    event = {
        "user": "UAPPROVER01",
        "text": "bot message",
        "thread_ts": "thread_123",
        "subtype": "bot_message",
    }
    await app.call_event("message", event)

    sm.get_pending_questions_for_thread.assert_not_called()


# TEST-112: 非承認ユーザーのスレッド返信 → 無視
@pytest.mark.asyncio
async def test_thread_reply_unauthorized_ignored():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()
    bot = _make_bot()
    sm = _make_session_manager()

    register_thread_reply_handler(app, sm, bridge, bot, config, audit)

    event = {
        "user": "U_INTRUDER",
        "text": "unauthorized reply",
        "thread_ts": "thread_123",
    }
    await app.call_event("message", event)

    sm.get_pending_questions_for_thread.assert_not_called()


# TEST-129: message_changed subtype のスレッド返信 → 無視
@pytest.mark.asyncio
async def test_thread_reply_message_changed_ignored():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()
    bot = _make_bot()
    sm = _make_session_manager()

    register_thread_reply_handler(app, sm, bridge, bot, config, audit)

    event = {
        "user": "UAPPROVER01",
        "text": "edited message",
        "thread_ts": "thread_123",
        "subtype": "message_changed",
    }
    await app.call_event("message", event)

    sm.get_pending_questions_for_thread.assert_not_called()


# TEST-121: 単一解放と全解放の検証
def test_thread_question_mapping_single_unregister():
    """unregister_thread_question で該当質問のみ解放される。"""
    bot = _make_bot()
    bridge = RequestBridge()
    config = _make_config()
    audit = AuditLog(":memory:")

    sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

    sm.register_thread_question("thread_1", "cid_1", 0, "msg_ts_0")
    sm.register_thread_question("thread_1", "cid_1", 1, "msg_ts_1")

    sm.unregister_thread_question("thread_1", "cid_1", 0)

    remaining = sm.get_pending_questions_for_thread("thread_1")
    assert len(remaining) == 1
    assert remaining[0]["question_index"] == 1


def test_thread_question_mapping_full_unregister():
    """unregister_thread_questions で全質問が解放される。"""
    bot = _make_bot()
    bridge = RequestBridge()
    config = _make_config()
    audit = AuditLog(":memory:")

    sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

    sm.register_thread_question("thread_1", "cid_1", 0, "msg_ts_0")
    sm.register_thread_question("thread_1", "cid_1", 1, "msg_ts_1")

    sm.unregister_thread_questions("cid_1")

    remaining = sm.get_pending_questions_for_thread("thread_1")
    assert remaining == []


# TEST-122: register_thread_question で質問単位の message_ts が保持される
def test_thread_question_mapping_message_ts():
    bot = _make_bot()
    bridge = RequestBridge()
    config = _make_config()
    audit = AuditLog(":memory:")

    sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

    sm.register_thread_question("thread_1", "cid_1", 0, "msg_ts_0")

    entries = sm.get_pending_questions_for_thread("thread_1")
    assert len(entries) == 1
    assert entries[0]["cid"] == "cid_1"
    assert entries[0]["question_index"] == 0
    assert entries[0]["message_ts"] == "msg_ts_0"


# TEST-124: 単一解放で他の質問マッピングは残存する
def test_thread_question_mapping_single_unregister_preserves_others():
    bot = _make_bot()
    bridge = RequestBridge()
    config = _make_config()
    audit = AuditLog(":memory:")

    sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

    sm.register_thread_question("thread_1", "cid_1", 0, "msg_ts_0")
    sm.register_thread_question("thread_1", "cid_1", 1, "msg_ts_1")
    sm.register_thread_question("thread_1", "cid_2", 0, "msg_ts_2")

    sm.unregister_thread_question("thread_1", "cid_1", 0)

    remaining = sm.get_pending_questions_for_thread("thread_1")
    assert len(remaining) == 2
    cids = [(e["cid"], e["question_index"]) for e in remaining]
    assert ("cid_1", 1) in cids
    assert ("cid_2", 0) in cids


# 非スレッドメッセージ → 無視
@pytest.mark.asyncio
async def test_thread_reply_non_thread_ignored():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    app = FakeApp()
    bot = _make_bot()
    sm = _make_session_manager()

    register_thread_reply_handler(app, sm, bridge, bot, config, audit)

    event = {
        "user": "UAPPROVER01",
        "text": "Not a thread reply",
    }
    await app.call_event("message", event)

    sm.get_pending_questions_for_thread.assert_not_called()
