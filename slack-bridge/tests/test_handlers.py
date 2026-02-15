"""ハンドラのモックテスト (TEST-015, 016, 017)"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.bridge import RequestBridge
from src.audit import AuditLog
from src.config import Config
from src.handlers.permission import register_permission_handlers
from src.handlers.ask_question import register_ask_handlers, _try_resolve_all_answered


def _make_config(**overrides) -> Config:
    defaults = dict(
        slack_app_token="xapp-test",
        slack_bot_token="xoxb-test",
        slack_channel="test-channel",
        slack_approver_user_id="U_APPROVER",
    )
    defaults.update(overrides)
    return Config(**defaults)


class FakeApp:
    """Slack app のハンドラ登録をキャプチャする。"""

    def __init__(self):
        self._actions = {}
        self._events = {}

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

    async def call_action(self, action_id, body):
        # 正規表現パターンマッチ
        import re
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

    async def call_event(self, event_name, event):
        fn = self._events.get(event_name)
        if fn:
            await fn(event=event, client=AsyncMock())


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
        "user": {"id": "U_APPROVER"},
        "actions": [{"value": cid, "action_id": "perm_allow"}],
        "message": {"ts": "123.456", "blocks": []},
        "channel": {"id": "C123"},
    }
    await app.call_action("perm_allow", body)

    assert req.result == {"decision": "allow", "user_id": "U_APPROVER"}
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


# TEST-017: 非許可ユーザーのスレッド返信は無視される
@pytest.mark.asyncio
async def test_unauthorized_thread_reply_ignored():
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
    bridge.register_thread("msg_ts_1", cid, 0)

    event = {
        "thread_ts": "msg_ts_1",
        "user": "U_INTRUDER",
        "text": "my answer",
        "channel": config.slack_channel,
    }
    await app.call_event("message", event)

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
        "last_user_id": "U_APPROVER",
    }

    _try_resolve_all_answered(bridge, cid)

    assert req.event.is_set()
    assert req.result["decision"] == "answered"
    assert req.result["answers"] == {"Q1?": "A", "Q2?": "B"}


# TEST: 承認ユーザーのスレッド返信（Other）は受け付けられる
@pytest.mark.asyncio
async def test_authorized_thread_reply():
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
    bridge.register_thread("msg_ts_1", cid, 0)

    event = {
        "thread_ts": "msg_ts_1",
        "user": "U_APPROVER",
        "text": "my custom answer",
        "channel": config.slack_channel,
    }
    await app.call_event("message", event)

    # 回答が格納され resolve されている
    assert req._question_meta["answers"]["Q1?"] == "my custom answer"
    assert req.event.is_set()
    assert req.result["decision"] == "answered"
