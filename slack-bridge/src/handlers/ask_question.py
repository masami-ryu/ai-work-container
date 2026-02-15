"""AskUserQuestion ハンドラ: 選択式ボタン + Other スレッド返信"""

from __future__ import annotations

import logging
import re
import time
from typing import TYPE_CHECKING, Any

from ..slack_messages import (
    ask_question_blocks,
    ask_resolved_blocks,
    ask_timeout_blocks,
)

if TYPE_CHECKING:
    from slack_bolt.app.async_app import AsyncApp
    from ..bridge import RequestBridge
    from ..audit import AuditLog
    from ..config import Config

logger = logging.getLogger(__name__)


async def handle_ask_question(
    input_data: dict[str, Any],
    *,
    bridge: RequestBridge,
    bot: Any,
    config: Config,
    audit: AuditLog,
) -> dict:
    """AskUserQuestion を Slack に投稿し、全質問の回答を待つ。"""
    questions = input_data.get("questions", [])
    if not questions:
        return {"decision": "deny", "reason": "no_questions"}

    req = bridge.create_request("ask_question")
    cid = req.correlation_id

    # multiSelect がある場合は partial_selections を初期化
    has_multi = any(q.get("multiSelect", False) for q in questions)
    if has_multi:
        req.partial_selections = {}

    # 各質問を個別メッセージとして投稿
    question_keys: list[str] = []  # question_text のリスト（answers のキー）
    message_ts_list: list[str] = []  # 各質問の message_ts
    for qi, q in enumerate(questions):
        q_text = q.get("question", "")
        header = q.get("header", "")
        options = q.get("options", [])
        multi_select = q.get("multiSelect", False)
        question_keys.append(q_text)

        blocks = ask_question_blocks(
            question_text=q_text,
            header=header,
            options=options,
            correlation_id=cid,
            question_index=qi,
            multi_select=multi_select,
            timeout_sec=config.ask_question_timeout_sec,
        )
        resp = await bot.post_message(
            blocks=blocks,
            text=f"Question: {q_text}",
        )
        msg_ts = resp["ts"]
        message_ts_list.append(msg_ts)
        if qi == 0:
            req.message_ts = msg_ts
        # スレッド相関登録（Other 自由入力用）
        bridge.register_thread(msg_ts, cid, qi)

    # _question_meta を bridge に保存（action ハンドラから参照）
    meta: dict[str, Any] = {
        "questions": questions,
        "question_keys": question_keys,
        "answers": {},
        "answered_count": 0,
        "total": len(questions),
    }
    req._question_meta = meta  # type: ignore[attr-defined]

    start = time.time()
    result = await bridge.wait_for_response(cid, timeout=config.ask_question_timeout_sec)
    elapsed = time.time() - start

    decision = result.get("decision", "deny")
    if decision == "timeout" or result.get("reason") == "timeout":
        for qi, q_text in enumerate(question_keys):
            if q_text not in meta.get("answers", {}):
                try:
                    await bot.update_message(
                        ts=message_ts_list[qi],
                        blocks=ask_timeout_blocks(q_text),
                    )
                except Exception:
                    pass
        audit.record(
            correlation_id=cid,
            request_type="ask_question",
            tool_name="AskUserQuestion",
            decision="timeout",
            response_time_sec=elapsed,
        )
    else:
        audit.record(
            correlation_id=cid,
            request_type="ask_question",
            tool_name="AskUserQuestion",
            summary=str(result.get("answers", {}))[:500],
            decision="answered",
            responder_user_id=result.get("user_id"),
            response_time_sec=elapsed,
        )

    return result


def _try_resolve_all_answered(
    bridge: RequestBridge, correlation_id: str
) -> None:
    """全質問に回答済みなら resolve する。"""
    req = bridge._pending.get(correlation_id)
    if req is None:
        return
    meta = getattr(req, "_question_meta", None)
    if meta is None:
        return
    if meta["answered_count"] >= meta["total"]:
        bridge.resolve(
            correlation_id,
            {
                "decision": "answered",
                "answers": meta["answers"],
                "user_id": meta.get("last_user_id"),
            },
        )


def register_ask_handlers(
    app: AsyncApp,
    bridge: RequestBridge,
    audit: AuditLog,
    config: Config,
) -> None:
    """Slack action/event ハンドラを登録する。"""

    # --- 単一選択ボタン (ask_choice_*) ---

    @app.action(re.compile(r"^ask_choice_\d+_\d+$"))
    async def on_choice(ack, body, client):
        await ack()
        user_id = body["user"]["id"]
        action = body["actions"][0]
        value = action["value"]  # "correlation_id|question_index|option_index"

        if user_id != config.slack_approver_user_id:
            parts = value.split("|")
            audit.record(
                correlation_id=parts[0] if parts else "unknown",
                request_type="ask_question",
                decision="rejected_user",
                responder_user_id=user_id,
            )
            logger.warning("Rejected ask_choice from unauthorized user %s", user_id)
            return

        parts = value.split("|")
        if len(parts) != 3:
            return
        cid, qi_str, oi_str = parts
        qi, oi = int(qi_str), int(oi_str)

        if not bridge.has_pending(cid):
            return

        req = bridge._pending.get(cid)
        if req is None:
            return
        meta = getattr(req, "_question_meta", None)
        if meta is None:
            return

        q = meta["questions"][qi]
        q_text = meta["question_keys"][qi]

        # 既にこの質問に回答済みなら無視
        if q_text in meta["answers"]:
            return

        selected_label = q["options"][oi]["label"]
        meta["answers"][q_text] = selected_label
        meta["answered_count"] += 1
        meta["last_user_id"] = user_id

        # メッセージを確定テキストに更新
        msg_ts = body["message"]["ts"]
        channel = body["channel"]["id"]
        await client.chat_update(
            channel=channel,
            ts=msg_ts,
            blocks=ask_resolved_blocks(q_text, selected_label, user_id),
            text=f"{q_text} → {selected_label}",
        )

        audit.record(
            correlation_id=cid,
            request_type="ask_question",
            tool_name="AskUserQuestion",
            summary=q_text,
            decision=f"selected:{selected_label}",
            responder_user_id=user_id,
        )

        _try_resolve_all_answered(bridge, cid)

    # --- multiSelect トグル (ask_toggle_*) ---

    @app.action(re.compile(r"^ask_toggle_\d+_\d+$"))
    async def on_toggle(ack, body, client):
        await ack()
        user_id = body["user"]["id"]
        action = body["actions"][0]
        value = action["value"]

        if user_id != config.slack_approver_user_id:
            parts = value.split("|")
            audit.record(
                correlation_id=parts[0] if parts else "unknown",
                request_type="ask_question",
                decision="rejected_user",
                responder_user_id=user_id,
            )
            return

        parts = value.split("|")
        if len(parts) != 3:
            return
        cid, qi_str, oi_str = parts
        qi, oi = int(qi_str), int(oi_str)

        if not bridge.has_pending(cid):
            return

        req = bridge._pending.get(cid)
        if req is None:
            return
        meta = getattr(req, "_question_meta", None)
        if meta is None:
            return

        q = meta["questions"][qi]
        q_text = meta["question_keys"][qi]
        label = q["options"][oi]["label"]

        # トグル
        current = bridge.toggle_selection(cid, q_text, label)

        # メッセージを更新（選択状態を反映）
        msg_ts = body["message"]["ts"]
        channel = body["channel"]["id"]
        blocks = ask_question_blocks(
            question_text=q_text,
            header=q.get("header", ""),
            options=q["options"],
            correlation_id=cid,
            question_index=qi,
            multi_select=True,
            timeout_sec=config.ask_question_timeout_sec,
            selected_labels=current,
        )
        await client.chat_update(
            channel=channel,
            ts=msg_ts,
            blocks=blocks,
            text=f"Question: {q_text}",
        )

    # --- multiSelect 確定 (ask_confirm_*) ---

    @app.action(re.compile(r"^ask_confirm_\d+$"))
    async def on_confirm(ack, body, client):
        await ack()
        user_id = body["user"]["id"]
        action = body["actions"][0]
        cid = action["value"]

        if user_id != config.slack_approver_user_id:
            audit.record(
                correlation_id=cid,
                request_type="ask_question",
                decision="rejected_user",
                responder_user_id=user_id,
            )
            return

        if not bridge.has_pending(cid):
            return

        req = bridge._pending.get(cid)
        if req is None:
            return
        meta = getattr(req, "_question_meta", None)
        if meta is None:
            return

        # partial_selections → answers にマージ
        for q_text, labels in (req.partial_selections or {}).items():
            if q_text not in meta["answers"]:
                meta["answers"][q_text] = ", ".join(labels)
                meta["answered_count"] += 1

        meta["last_user_id"] = user_id

        # 確定メッセージに更新
        msg_ts = body["message"]["ts"]
        channel = body["channel"]["id"]
        # action_id から question_index を取得
        aid = action["action_id"]  # "ask_confirm_0"
        qi = int(aid.rsplit("_", 1)[1])
        q_text = meta["question_keys"][qi]
        answer = meta["answers"].get(q_text, "(none)")
        await client.chat_update(
            channel=channel,
            ts=msg_ts,
            blocks=ask_resolved_blocks(q_text, answer, user_id),
            text=f"{q_text} → {answer}",
        )

        audit.record(
            correlation_id=cid,
            request_type="ask_question",
            tool_name="AskUserQuestion",
            summary=q_text,
            decision=f"selected:{answer}",
            responder_user_id=user_id,
        )

        _try_resolve_all_answered(bridge, cid)

    # --- Other スレッド返信 ---

    @app.event("message")
    async def on_message(event, client):
        # スレッド返信のみ処理
        thread_ts = event.get("thread_ts")
        if not thread_ts:
            return

        # Bot 自身のメッセージは無視
        if event.get("bot_id"):
            return

        user_id = event.get("user", "")
        text = event.get("text", "").strip()
        if not text:
            return

        if user_id != config.slack_approver_user_id:
            correlation = bridge.get_correlation_for_thread(thread_ts)
            audit.record(
                correlation_id=correlation[0] if correlation else "unknown",
                request_type="ask_question",
                decision="rejected_user",
                responder_user_id=user_id,
                summary=f"thread reply ignored: {text[:100]}",
            )
            logger.warning("Ignored thread reply from unauthorized user %s", user_id)
            return

        correlation = bridge.get_correlation_for_thread(thread_ts)
        if correlation is None:
            return

        cid, qi = correlation

        if not bridge.has_pending(cid):
            return

        req = bridge._pending.get(cid)
        if req is None:
            return
        meta = getattr(req, "_question_meta", None)
        if meta is None:
            return

        q_text = meta["question_keys"][qi]

        # multiSelect の場合: スレッド返信で途中選択を破棄し即時 resolve
        q = meta["questions"][qi]
        if q.get("multiSelect", False) and req.partial_selections:
            req.partial_selections.pop(q_text, None)

        # 既にこの質問に回答済みなら無視
        if q_text in meta["answers"]:
            return

        meta["answers"][q_text] = text  # ユーザーの実テキスト
        meta["answered_count"] += 1
        meta["last_user_id"] = user_id

        # 元メッセージを確定テキストに更新
        channel = event.get("channel", config.slack_channel)
        await client.chat_update(
            channel=channel,
            ts=thread_ts,
            blocks=ask_resolved_blocks(q_text, text, user_id),
            text=f"{q_text} → {text}",
        )

        audit.record(
            correlation_id=cid,
            request_type="ask_question",
            tool_name="AskUserQuestion",
            summary=q_text,
            decision=f"other:{text[:200]}",
            responder_user_id=user_id,
        )

        _try_resolve_all_answered(bridge, cid)
