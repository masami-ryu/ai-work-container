"""権限確認ハンドラ: Allow/Deny ボタン → Slack → Agent SDK"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

from ..slack_messages import (
    permission_blocks,
    permission_resolved_blocks,
    permission_timeout_blocks,
)

if TYPE_CHECKING:
    from slack_bolt.app.async_app import AsyncApp
    from ..bridge import RequestBridge
    from ..audit import AuditLog
    from ..config import Config

logger = logging.getLogger(__name__)


async def handle_permission(
    tool_name: str,
    input_data: dict[str, Any],
    *,
    bridge: RequestBridge,
    bot: Any,
    config: Config,
    audit: AuditLog,
) -> dict:
    """権限確認を Slack に投稿し、応答を待つ。"""
    req = bridge.create_request("permission")
    cid = req.correlation_id

    blocks = permission_blocks(
        tool_name=tool_name,
        input_data=input_data,
        correlation_id=cid,
        timeout_sec=config.permission_timeout_sec,
    )
    resp = await bot.post_message(blocks=blocks, text=f"Permission: {tool_name}")
    req.message_ts = resp["ts"]

    start = time.time()
    result = await bridge.wait_for_response(cid, timeout=config.permission_timeout_sec)
    elapsed = time.time() - start

    decision = result.get("decision", "deny")

    if decision == "timeout" or result.get("reason") == "timeout":
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
            return

        bridge.resolve(value, {"decision": "allow", "user_id": user_id})

        # ボタンを確定テキストに置換
        msg_ts = body["message"]["ts"]
        channel = body["channel"]["id"]
        # tool_name はメッセージから取得
        tool_name = _extract_tool_name(body)
        await client.chat_update(
            channel=channel,
            ts=msg_ts,
            blocks=permission_resolved_blocks(tool_name, "allow", user_id),
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
            return

        bridge.resolve(value, {"decision": "deny", "user_id": user_id})

        msg_ts = body["message"]["ts"]
        channel = body["channel"]["id"]
        tool_name = _extract_tool_name(body)
        await client.chat_update(
            channel=channel,
            ts=msg_ts,
            blocks=permission_resolved_blocks(tool_name, "deny", user_id),
            text=f"{tool_name} → DENY",
        )


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
