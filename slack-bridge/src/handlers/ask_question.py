"""AskUserQuestion ハンドラ: 選択式ボタン + Other modal 方式"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import TYPE_CHECKING, Any

from ..slack_bot import SlackAPIError
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

# タイムアウト後のボタンクリック時の ephemeral メッセージ
_TIMED_OUT_EPHEMERAL = "⏰ This question has already timed out. Your response was not recorded."


async def handle_ask_question(
    input_data: dict[str, Any],
    *,
    bridge: RequestBridge,
    bot: Any,
    config: Config,
    audit: AuditLog,
    thread_ts: str | None = None,
    session_manager: Any | None = None,
) -> dict:
    """AskUserQuestion を Slack に投稿し、全質問の回答を待つ。

    TASK-104: 認可系 Slack API 失敗時は fail-close（deny を返す）。
    """
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
    try:
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
                thread_ts=thread_ts,
            )
            msg_ts = resp["ts"]
            message_ts_list.append(msg_ts)
            if qi == 0:
                req.message_ts = msg_ts
    except Exception as e:
        # TASK-104: 認可系 API 失敗時は fail-close
        logger.error("Failed to post ask_question message: %s", e)
        bridge.resolve(cid, {"decision": "deny", "reason": "slack_api_error"})
        audit.record(
            correlation_id=cid,
            request_type="ask_question",
            tool_name="AskUserQuestion",
            decision="deny",
            summary=f"slack_api_error: {e}",
        )
        return {"decision": "deny", "reason": "slack_api_error"}

    # _question_meta を bridge に保存（action ハンドラから参照）
    meta: dict[str, Any] = {
        "questions": questions,
        "question_keys": question_keys,
        "answers": {},
        "answered_count": 0,
        "total": len(questions),
    }
    req._question_meta = meta  # type: ignore[attr-defined]

    # スレッド→質問マッピングを登録（スレッド返信による回答を可能にする）
    if session_manager is not None and thread_ts is not None:
        for qi, msg_ts in enumerate(message_ts_list):
            session_manager.register_thread_question(thread_ts, cid, qi, msg_ts)

    start = time.time()
    result = await bridge.wait_for_response(cid, timeout=config.ask_question_timeout_sec)
    elapsed = time.time() - start

    decision = result.get("decision", "deny")
    reason = result.get("reason", "")

    if decision == "timeout" or reason == "timeout":
        # TASK-103: タイムアウト時に回答済み分を保存して返す
        partial_answers = dict(meta.get("answers", {}))
        for qi, q_text in enumerate(question_keys):
            if q_text not in partial_answers:
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
            summary=f"partial_answers={partial_answers}" if partial_answers else None,
            response_time_sec=elapsed,
        )
        # 部分回答がある場合はそれを含めて返す
        if partial_answers:
            return {
                "decision": "answered",
                "answers": partial_answers,
                "partial": True,
                "user_id": meta.get("last_user_id"),
            }
    elif reason == "not_found":
        # TASK-105: not_found もタイムアウトと同様にメッセージ更新
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
            decision="deny",
            summary="not_found",
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

    # スレッド→質問マッピングを全解放
    if session_manager is not None:
        session_manager.unregister_thread_questions(cid)

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
    bot: Any | None = None,
) -> None:
    """Slack action/view ハンドラを登録する。"""

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
            if bot is not None:
                channel = body["channel"]["id"]
                await bot.post_ephemeral(
                    channel=channel, user=user_id, text=_TIMED_OUT_EPHEMERAL,
                )
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
        if bot is not None:
            try:
                await bot.update_message(
                    ts=msg_ts,
                    blocks=ask_resolved_blocks(q_text, selected_label, user_id),
                    text=f"{q_text} → {selected_label}",
                    channel=channel,
                )
            except SlackAPIError as e:
                logger.error("Failed to update ask_choice message: %s", e)
                await bot.post_ephemeral(
                    channel=channel, user=user_id,
                    text=f"✅ 回答は受け付けました: {selected_label} (message update failed)",
                )
        else:
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
            if bot is not None:
                channel = body["channel"]["id"]
                await bot.post_ephemeral(
                    channel=channel, user=user_id, text=_TIMED_OUT_EPHEMERAL,
                )
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
        if bot is not None:
            try:
                await bot.update_message(
                    ts=msg_ts,
                    blocks=blocks,
                    text=f"Question: {q_text}",
                    channel=channel,
                )
            except SlackAPIError as e:
                logger.error("Failed to update ask_toggle message: %s", e)
        else:
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
            if bot is not None:
                channel = body["channel"]["id"]
                await bot.post_ephemeral(
                    channel=channel, user=user_id, text=_TIMED_OUT_EPHEMERAL,
                )
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
        if bot is not None:
            try:
                await bot.update_message(
                    ts=msg_ts,
                    blocks=ask_resolved_blocks(q_text, answer, user_id),
                    text=f"{q_text} → {answer}",
                    channel=channel,
                )
            except SlackAPIError as e:
                logger.error("Failed to update ask_confirm message: %s", e)
                await bot.post_ephemeral(
                    channel=channel, user=user_id,
                    text=f"✅ 回答は受け付けました: {answer} (message update failed)",
                )
        else:
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

    # --- Other 回答ボタン (ask_other_*) → modal 表示 ---

    @app.action(re.compile(r"^ask_other_\d+$"))
    async def on_other_button(ack, body, client):
        await ack()
        user_id = body["user"]["id"]
        action = body["actions"][0]
        value = action["value"]  # "correlation_id|question_index"

        parts = value.split("|")
        if len(parts) != 2:
            return
        cid, qi_str = parts

        if user_id != config.slack_approver_user_id:
            audit.record(
                correlation_id=cid,
                request_type="ask_question",
                decision="rejected_user",
                responder_user_id=user_id,
                summary="ask_other button rejected",
            )
            logger.warning("Rejected ask_other from unauthorized user %s", user_id)
            return

        if not bridge.has_pending(cid):
            if bot is not None:
                channel = body["channel"]["id"]
                await bot.post_ephemeral(
                    channel=channel, user=user_id, text=_TIMED_OUT_EPHEMERAL,
                )
            return

        trigger_id = body["trigger_id"]
        private_metadata = json.dumps({
            "correlation_id": cid,
            "question_index": int(qi_str),
        })

        await client.views_open(
            trigger_id=trigger_id,
            view={
                "type": "modal",
                "callback_id": "ask_other_submit",
                "private_metadata": private_metadata,
                "title": {"type": "plain_text", "text": "Other Answer"},
                "submit": {"type": "plain_text", "text": "Submit"},
                "close": {"type": "plain_text", "text": "Cancel"},
                "blocks": [
                    {
                        "type": "input",
                        "block_id": "answer_block",
                        "element": {
                            "type": "plain_text_input",
                            "action_id": "answer_input",
                            "multiline": True,
                            "placeholder": {
                                "type": "plain_text",
                                "text": "Enter your answer...",
                            },
                        },
                        "label": {"type": "plain_text", "text": "Your answer"},
                    }
                ],
            },
        )

    # --- Other modal submission ---

    @app.view("ask_other_submit")
    async def on_other_submit(ack, body, client):
        user_id = body["user"]["id"]

        private_metadata = json.loads(body["view"]["private_metadata"])
        cid = private_metadata["correlation_id"]
        qi = private_metadata["question_index"]

        # TASK-102: タイムアウト後の modal submission にはエラーレスポンスを返す
        if not bridge.has_pending(cid):
            await ack(
                response_action="errors",
                errors={"answer_block": "This question has already timed out. Your answer was not recorded."},
            )
            return

        if user_id != config.slack_approver_user_id:
            await ack()
            audit.record(
                correlation_id=cid,
                request_type="ask_question",
                decision="rejected_user",
                responder_user_id=user_id,
                summary="ask_other modal submission rejected",
            )
            logger.warning(
                "Rejected ask_other submission from unauthorized user %s", user_id
            )
            return

        await ack()

        req = bridge._pending.get(cid)
        if req is None:
            return
        meta = getattr(req, "_question_meta", None)
        if meta is None:
            return

        q_text = meta["question_keys"][qi]

        # multiSelect の場合: 途中選択を破棄
        q = meta["questions"][qi]
        if q.get("multiSelect", False) and req.partial_selections:
            req.partial_selections.pop(q_text, None)

        # 既にこの質問に回答済みなら無視
        if q_text in meta["answers"]:
            return

        # modal の入力値を取得
        text = (
            body["view"]["state"]["values"]["answer_block"]["answer_input"]["value"]
            or ""
        ).strip()
        if not text:
            return

        meta["answers"][q_text] = text
        meta["answered_count"] += 1
        meta["last_user_id"] = user_id

        audit.record(
            correlation_id=cid,
            request_type="ask_question",
            tool_name="AskUserQuestion",
            summary=q_text,
            decision=f"other:{text[:200]}",
            responder_user_id=user_id,
        )

        _try_resolve_all_answered(bridge, cid)
