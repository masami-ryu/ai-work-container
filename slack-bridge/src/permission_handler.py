"""canUseTool 統合コールバック: 権限確認と AskUserQuestion の振り分け"""

from __future__ import annotations

import logging
from typing import Any

from claude_agent_sdk.types import PermissionResultAllow, PermissionResultDeny

from .bridge import RequestBridge
from .audit import AuditLog
from .config import Config

logger = logging.getLogger(__name__)

# 自動許可するツール
AUTO_ALLOW_TOOLS = frozenset({
    "Read", "Glob", "Grep", "WebSearch", "WebFetch",
    "TodoWrite", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList",
})


def create_permission_callback(
    bridge: RequestBridge,
    bot: Any,  # SlackBot
    config: Config,
    audit: AuditLog,
):
    """canUseTool コールバックを生成する。"""

    async def can_use_tool(
        tool_name: str,
        input_data: dict[str, Any],
        context: Any,
    ) -> PermissionResultAllow | PermissionResultDeny:
        # 1. 安全なツールは自動許可
        if tool_name in AUTO_ALLOW_TOOLS:
            return PermissionResultAllow(updated_input=input_data)

        # 2. AskUserQuestion → 質問ハンドラへ
        if tool_name == "AskUserQuestion":
            from .handlers.ask_question import handle_ask_question

            result = await handle_ask_question(
                input_data,
                bridge=bridge,
                bot=bot,
                config=config,
                audit=audit,
            )
            if result.get("decision") == "answered":
                return PermissionResultAllow(
                    updated_input={**input_data, "answers": result.get("answers", {})}
                )
            return PermissionResultDeny(
                message=result.get("reason", "Question cancelled or timed out")
            )

        # 3. その他のツール → 権限確認ハンドラへ
        from .handlers.permission import handle_permission

        result = await handle_permission(
            tool_name,
            input_data,
            bridge=bridge,
            bot=bot,
            config=config,
            audit=audit,
        )
        decision = result.get("decision", "deny")
        if decision == "allow":
            return PermissionResultAllow(updated_input=input_data)
        return PermissionResultDeny(
            message=result.get("reason", "Permission denied via Slack")
        )

    return can_use_tool
