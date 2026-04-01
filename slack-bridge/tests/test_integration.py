"""統合テスト: スラッシュコマンド→セッション開始→質問→スレッド返信→完了"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.bridge import RequestBridge
from src.audit import AuditLog
from src.config import Config
from src.session import SessionManager
from src.handlers.ask_question import handle_ask_question


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
    bot.post_ephemeral = AsyncMock()
    return bot


# TEST-113: スレッド返信による質問回答の統合フロー
@pytest.mark.asyncio
async def test_thread_reply_integration_flow():
    """handle_ask_question → register_thread_question → スレッド返信 → resolve"""
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config(ask_question_timeout_sec=30)
    bot = _make_bot()

    # 各質問に異なる ts を返すようにする
    ts_counter = [0]
    async def fake_post_message(**kwargs):
        ts_counter[0] += 1
        return {"ts": f"msg_ts_{ts_counter[0]}"}
    bot.post_message = fake_post_message

    sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

    # handle_ask_question を起動（バックグラウンドで待機する）
    input_data = {
        "questions": [
            {
                "question": "What framework?",
                "header": "Framework",
                "options": [{"label": "React"}, {"label": "Vue"}],
            },
        ],
    }

    # 非同期で handle_ask_question を起動
    task = asyncio.create_task(
        handle_ask_question(
            input_data,
            bridge=bridge,
            bot=bot,
            config=config,
            audit=audit,
            thread_ts="thread_123",
            session_manager=sm,
        )
    )

    # handle_ask_question が質問を投稿するのを待つ
    await asyncio.sleep(0.1)

    # スレッドマッピングが登録されていることを確認
    pending = sm.get_pending_questions_for_thread("thread_123")
    assert len(pending) == 1
    assert pending[0]["message_ts"] == "msg_ts_1"

    cid = pending[0]["cid"]

    # bridge の pending request を取得
    req = bridge._pending.get(cid)
    assert req is not None

    # スレッド返信をシミュレート（bridge の回答を直接設定）
    meta = req._question_meta
    meta["answers"]["What framework?"] = "React via thread"
    meta["answered_count"] = 1
    meta["last_user_id"] = "UAPPROVER01"

    # unregister_thread_question
    sm.unregister_thread_question("thread_123", cid, 0)

    # resolve
    from src.handlers.ask_question import _try_resolve_all_answered
    _try_resolve_all_answered(bridge, cid)

    # タスクの完了を待つ
    result = await asyncio.wait_for(task, timeout=5.0)

    assert result["decision"] == "answered"
    assert result["answers"]["What framework?"] == "React via thread"

    # マッピングが解放されていること
    assert sm.get_pending_questions_for_thread("thread_123") == []


# list_running_sessions は running のみ返すことの検証
def test_list_running_sessions_filters():
    bot = _make_bot()
    bridge = RequestBridge()
    config = _make_config()
    audit = AuditLog(":memory:")

    sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

    # セッションを手動で作成
    from src.session import Session
    sm._sessions["s1"] = Session(session_id="s1", prompt="p1", cwd=".", status="running")
    sm._sessions["s2"] = Session(session_id="s2", prompt="p2", cwd=".", status="completed")
    sm._sessions["s3"] = Session(session_id="s3", prompt="p3", cwd=".", status="error")

    running = sm.list_running_sessions()
    assert len(running) == 1
    assert running[0]["session_id"] == "s1"


# stop_session で存在しないセッションのエラーメッセージ
@pytest.mark.asyncio
async def test_stop_session_not_found():
    bot = _make_bot()
    bridge = RequestBridge()
    config = _make_config()
    audit = AuditLog(":memory:")

    sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

    result = await sm.stop_session("nonexistent")
    assert "not found" in result
