"""権限確認ハンドラ: Allow/Deny ボタン → Slack → Agent SDK"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

from ..slack_bot import SlackAPIError

from ..slack_messages import (
    permission_blocks,
    permission_details_blocks,
    permission_resolved_blocks,
    permission_timeout_blocks,
    _command_summary,
)

if TYPE_CHECKING:
    from slack_bolt.app.async_app import AsyncApp
    from ..bridge import RequestBridge
    from ..audit import AuditLog
    from ..config import Config

logger = logging.getLogger(__name__)

# タイムアウト後のボタンクリック時の ephemeral メッセージ
_TIMED_OUT_EPHEMERAL = "⏰ This permission request has already timed out. Your response was not recorded."
# P4-004: セッション終了後の Details ボタンクリック時
_SESSION_ENDED_EPHEMERAL = "ℹ️ This session has ended. Details are no longer available."


def _command_summary_for_notification(tool_name: str, input_data: dict[str, Any]) -> str:
    """P4-002: プッシュ通知用のコンパクトなサマリを生成する。"""
    summary = _command_summary(tool_name, input_data)
    scope = summary.get("scope", "")
    if scope:
        return f"in {scope}"
    desc = summary.get("description", "")
    if desc:
        return desc[:60]
    return ""


async def handle_permission(
    tool_name: str,
    input_data: dict[str, Any],
    *,
    bridge: RequestBridge,
    bot: Any,
    config: Config,
    audit: AuditLog,
    thread_ts: str | None = None,
    session_id: str | None = None,
) -> dict:
    """権限確認を Slack に投稿し、応答を待つ。

    TASK-104: 認可系 Slack API 失敗時は fail-close（deny を返す）。
    P4-002: 通知テキストにセッションIDとスコープヒントを含める。
    """
    req = bridge.create_request("permission")
    cid = req.correlation_id

    # P4-004: input_data をリクエストに保持（Details ボタン用）
    req.input_data = input_data

    blocks = permission_blocks(
        tool_name=tool_name,
        input_data=input_data,
        correlation_id=cid,
        timeout_sec=config.permission_timeout_sec,
        session_id=session_id,
    )

    # P4-002: 通知テキストにセッションIDとスコープヒントを含める
    summary = _command_summary_for_notification(tool_name, input_data)
    session_prefix = f"[{session_id}] " if session_id else ""
    notification_text = f"Permission: {tool_name} {session_prefix}{summary}"

    # 認可系 API 失敗時は fail-close: deny を返す
    try:
        resp = await bot.post_message(
            blocks=blocks, text=notification_text, thread_ts=thread_ts
        )
    except Exception as e:
        logger.error("Failed to post permission message for %s: %s", tool_name, e)
        # pending を解消
        bridge.resolve(cid, {"decision": "deny", "reason": "slack_api_error"})
        audit.record(
            correlation_id=cid,
            request_type="permission",
            tool_name=tool_name,
            decision="deny",
            summary=f"slack_api_error: {e}",
        )
        return {"decision": "deny", "reason": "slack_api_error"}
    req.message_ts = resp["ts"]

    start = time.time()
    result = await bridge.wait_for_response(cid, timeout=config.permission_timeout_sec)
    elapsed = time.time() - start

    decision = result.get("decision", "deny")
    reason = result.get("reason", "")

    if decision == "timeout" or reason == "timeout":
        await bot.update_message(
            ts=req.message_ts,
            blocks=permission_timeout_blocks(tool_name),
        )
        audit.record(
            correlation_id=cid,
            request_type="permission",
            tool_name=tool_name,
            decision="timeout",
            response_time_sec=elapsed,
            slack_message_ts=req.message_ts,
        )
    elif reason == "not_found":
        # TASK-105: not_found もタイムアウトと同様にメッセージ更新
        await bot.update_message(
            ts=req.message_ts,
            blocks=permission_timeout_blocks(tool_name),
        )
        audit.record(
            correlation_id=cid,
            request_type="permission",
            tool_name=tool_name,
            decision="deny",
            summary="not_found",
            response_time_sec=elapsed,
            slack_message_ts=req.message_ts,
        )
    else:
        audit.record(
            correlation_id=cid,
            request_type="permission",
            tool_name=tool_name,
            decision=decision,
            responder_user_id=result.get("user_id"),
            response_time_sec=elapsed,
            slack_message_ts=req.message_ts,
        )

    return result


def register_permission_handlers(
    app: AsyncApp,
    bridge: RequestBridge,
    audit: AuditLog,
    config: Config,
    bot: Any | None = None,
) -> None:
    """Slack の action ハンドラを登録する。"""

    @app.action("perm_allow")
    async def on_allow(ack, body, client):
        await ack()
        user_id = body["user"]["id"]
        value = body["actions"][0]["value"]  # correlation_id

        if user_id != config.slack_approver_user_id:
            audit.record(
                correlation_id=value,
                request_type="permission",
                decision="rejected_user",
                responder_user_id=user_id,
            )
            logger.warning("Rejected perm_allow from unauthorized user %s", user_id)
            return

        if not bridge.has_pending(value):
            # タイムアウト後のボタンクリック: ephemeral メッセージで通知
            channel = body["channel"]["id"]
            try:
                await client.chat_postEphemeral(
                    channel=channel,
                    user=user_id,
                    text=_TIMED_OUT_EPHEMERAL,
                )
            except Exception:
                logger.warning("Failed to send ephemeral for timed-out permission %s", value)
            return

        bridge.resolve(value, {"decision": "allow", "user_id": user_id})

        # ボタンを確定テキストに置換（TASK-404: コマンドサマリも残す）
        msg_ts = body["message"]["ts"]
        channel = body["channel"]["id"]
        tool_name = _extract_tool_name(body)
        summary_text = _extract_command_summary(body)
        if bot is not None:
            try:
                await bot.update_message(
                    ts=msg_ts,
                    blocks=permission_resolved_blocks(tool_name, "allow", user_id, summary_text),
                    text=f"{tool_name} → ALLOW",
                    channel=channel,
                )
            except SlackAPIError as e:
                logger.error("Failed to update permission message: %s", e)
                await bot.post_ephemeral(
                    channel=channel, user=user_id, text="✅ Permission allowed (message update failed)",
                )
        else:
            await client.chat_update(
                channel=channel,
                ts=msg_ts,
                blocks=permission_resolved_blocks(tool_name, "allow", user_id, summary_text),
                text=f"{tool_name} → ALLOW",
            )

    @app.action("perm_deny")
    async def on_deny(ack, body, client):
        await ack()
        user_id = body["user"]["id"]
        value = body["actions"][0]["value"]

        if user_id != config.slack_approver_user_id:
            audit.record(
                correlation_id=value,
                request_type="permission",
                decision="rejected_user",
                responder_user_id=user_id,
            )
            logger.warning("Rejected perm_deny from unauthorized user %s", user_id)
            return

        if not bridge.has_pending(value):
            # タイムアウト後のボタンクリック: ephemeral メッセージで通知
            channel = body["channel"]["id"]
            try:
                await client.chat_postEphemeral(
                    channel=channel,
                    user=user_id,
                    text=_TIMED_OUT_EPHEMERAL,
                )
            except Exception:
                logger.warning("Failed to send ephemeral for timed-out permission %s", value)
            return

        bridge.resolve(value, {"decision": "deny", "user_id": user_id})

        msg_ts = body["message"]["ts"]
        channel = body["channel"]["id"]
        tool_name = _extract_tool_name(body)
        summary_text = _extract_command_summary(body)
        if bot is not None:
            try:
                await bot.update_message(
                    ts=msg_ts,
                    blocks=permission_resolved_blocks(tool_name, "deny", user_id, summary_text),
                    text=f"{tool_name} → DENY",
                    channel=channel,
                )
            except SlackAPIError as e:
                logger.error("Failed to update permission message: %s", e)
                await bot.post_ephemeral(
                    channel=channel, user=user_id, text="🚫 Permission denied (message update failed)",
                )
        else:
            await client.chat_update(
                channel=channel,
                ts=msg_ts,
                blocks=permission_resolved_blocks(tool_name, "deny", user_id, summary_text),
                text=f"{tool_name} → DENY",
            )


    @app.action("perm_details")
    async def on_details(ack, body, client):
        """P4-004: Details ボタン押下時にスレッド返信で詳細を表示する。"""
        await ack()
        user_id = body["user"]["id"]
        value = body["actions"][0]["value"]  # correlation_id
        channel = body["channel"]["id"]
        msg_ts = body["message"]["ts"]
        thread_ts = body["message"].get("thread_ts") or msg_ts

        # P4-004: 承認ユーザー検証
        if user_id != config.slack_approver_user_id:
            try:
                await client.chat_postEphemeral(
                    channel=channel,
                    user=user_id,
                    text="🔒 Only the approver can view details.",
                    thread_ts=thread_ts,
                )
            except Exception:
                pass
            return

        # P4-004: リクエストの input_data から詳細を取得
        req = bridge.get_request(value) if hasattr(bridge, "get_request") else None
        if req is None or not hasattr(req, "input_data"):
            # セッション終了後やタイムアウト後
            try:
                await client.chat_postEphemeral(
                    channel=channel,
                    user=user_id,
                    text=_SESSION_ENDED_EPHEMERAL,
                    thread_ts=thread_ts,
                )
            except Exception:
                pass
            return

        # P4-004: 詳細をスレッド返信で表示
        tool_name = _extract_tool_name_from_blocks(body)
        detail_blocks = permission_details_blocks(tool_name, req.input_data)
        if bot is not None:
            try:
                await bot.post_message(
                    blocks=detail_blocks,
                    text=f"Details for {tool_name}",
                    thread_ts=thread_ts,
                )
            except Exception:
                logger.warning("Failed to post permission details for %s", value)
        else:
            try:
                await client.chat_postMessage(
                    channel=channel,
                    blocks=detail_blocks,
                    text=f"Details for {tool_name}",
                    thread_ts=thread_ts,
                )
            except Exception:
                logger.warning("Failed to post permission details for %s", value)


def _extract_tool_name_from_blocks(body: dict) -> str:
    """P4-004: メッセージの blocks から tool 名を抽出する（コンパクト形式対応）。"""
    try:
        blocks = body["message"]["blocks"]
        for block in blocks:
            if block.get("type") == "section":
                text = block.get("text", {}).get("text", "")
                # P4-001 コンパクト形式: ":warning: *Bash* in `scope`"
                if "**" in text or "*" in text:
                    # *ToolName* を抽出
                    import re
                    match = re.search(r"\*(\w+)\*", text)
                    if match:
                        return match.group(1)
    except (KeyError, IndexError):
        pass
    return "Unknown"


def _extract_tool_name(body: dict) -> str:
    """メッセージの blocks から tool 名を抽出する。"""
    try:
        blocks = body["message"]["blocks"]
        for block in blocks:
            if block.get("type") == "section" and "fields" in block:
                for field in block["fields"]:
                    text = field.get("text", "")
                    if text.startswith("*Tool:*\n"):
                        return text.split("\n", 1)[1]
    except (KeyError, IndexError):
        pass
    return "Unknown"


def _extract_command_summary(body: dict) -> str | None:
    """TASK-404: メッセージの blocks からコマンドサマリを抽出する。"""
    try:
        blocks = body["message"]["blocks"]
        for block in blocks:
            if block.get("type") == "section":
                text = block.get("text", {}).get("text", "")
                # コードブロック内のテキストを抽出
                if text.startswith("```\n") and "```" in text[4:]:
                    # ```\n...\n``` の中身を取得
                    inner = text[4:]
                    end_idx = inner.rfind("```")
                    if end_idx > 0:
                        return inner[:end_idx].rstrip()
    except (KeyError, IndexError):
        pass
    return None
