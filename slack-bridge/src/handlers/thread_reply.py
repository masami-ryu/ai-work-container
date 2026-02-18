"""スレッド返信ハンドラ: スレッド返信による質問回答"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from ..handlers.ask_question import _try_resolve_all_answered
from ..slack_bot import SlackAPIError
from ..slack_messages import ask_resolved_blocks

if TYPE_CHECKING:
    from slack_bolt.app.async_app import AsyncApp
    from ..bridge import RequestBridge
    from ..audit import AuditLog
    from ..config import Config
    from ..session import SessionManager

logger = logging.getLogger(__name__)


def register_thread_reply_handler(
    app: AsyncApp,
    session_manager: SessionManager,
    bridge: RequestBridge,
    bot: Any,
    config: Config,
    audit: AuditLog,
) -> None:
    """message イベントハンドラを登録する。"""

    @app.event("message")
    async def on_message(event, say):
        # subtype が存在するイベントは無視（bot_message, message_changed 等）
        if event.get("subtype") is not None:
            return

        # スレッド内メッセージのみ処理
        thread_ts = event.get("thread_ts")
        if thread_ts is None:
            return

        # 承認ユーザーチェック
        user_id = event.get("user")
        if user_id != config.slack_approver_user_id:
            return

        # pending な質問を検索
        pending = session_manager.get_pending_questions_for_thread(thread_ts)
        if not pending:
            return

        # 最も古い未回答質問に回答を割り当てる
        entry = pending[0]
        cid = entry["cid"]
        question_index = entry["question_index"]
        message_ts = entry["message_ts"]

        text = event.get("text", "").strip()
        if not text:
            return

        # bridge の pending request から question_meta を取得
        req = bridge._pending.get(cid)
        if req is None:
            return
        meta = getattr(req, "_question_meta", None)
        if meta is None:
            return

        q_text = meta["question_keys"][question_index]

        # 既にこの質問に回答済みなら無視
        if q_text in meta["answers"]:
            return

        # 回答を記録
        meta["answers"][q_text] = text
        meta["answered_count"] += 1
        meta["last_user_id"] = user_id

        # 質問メッセージを更新
        try:
            await bot.update_message(
                ts=message_ts,
                blocks=ask_resolved_blocks(q_text, text, user_id),
                text=f"{q_text} → {text}",
            )
        except SlackAPIError as e:
            logger.error("Failed to update thread reply message: %s", e)

        # 監査ログ記録
        audit.record(
            correlation_id=cid,
            request_type="ask_question",
            tool_name="AskUserQuestion",
            summary=q_text,
            decision="thread_reply",
            responder_user_id=user_id,
        )

        # 単一解放
        session_manager.unregister_thread_question(thread_ts, cid, question_index)

        # 全回答完了チェック
        _try_resolve_all_answered(bridge, cid)
