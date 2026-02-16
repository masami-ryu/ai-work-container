"""canUseTool 統合コールバック: 権限確認と AskUserQuestion の振り分け"""

from __future__ import annotations

import logging
import time
from typing import Any, TYPE_CHECKING

from claude_agent_sdk.types import PermissionResultAllow, PermissionResultDeny

from .bridge import RequestBridge
from .audit import AuditLog
from .config import Config

if TYPE_CHECKING:
    from .session import Session

logger = logging.getLogger(__name__)

# 自動許可するツール
AUTO_ALLOW_TOOLS = frozenset({
    "Read", "Glob", "Grep", "WebSearch", "WebFetch",
    "TodoWrite", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList",
})

# TodoList 進捗通知のスロットリング間隔（秒）
_TODO_NOTIFY_MIN_INTERVAL = 30


def create_permission_callback(
    bridge: RequestBridge,
    bot: Any,  # SlackBot
    config: Config,
    audit: AuditLog,
    thread_ts: str | None = None,
    session: Session | None = None,
):
    """canUseTool コールバックを生成する。thread_ts でセッション毎のスレッドに投稿。

    TASK-302: session 引数を受け取り、ツール使用を session.stats に記録する。
    """
    # TASK-303: TodoList 進捗通知のスロットリング用
    _todo_last_notify_time: float = 0
    _todo_progress_msg_ts: str | None = None

    async def can_use_tool(
        tool_name: str,
        input_data: dict[str, Any],
        context: Any,
    ) -> PermissionResultAllow | PermissionResultDeny:
        nonlocal _todo_last_notify_time, _todo_progress_msg_ts

        # 1. 安全なツールは自動許可
        if tool_name in AUTO_ALLOW_TOOLS:
            # TASK-302: 自動許可ツールも統計に記録
            if session is not None:
                session.stats.record_use(tool_name, "auto_allow")

            # TASK-012: 自動許可ツールの監査ログ記録
            audit.record(
                correlation_id="auto",
                request_type="permission",
                tool_name=tool_name,
                decision="auto_allow",
            )

            # TASK-303: TodoWrite 実行時にSlackスレッドに進捗通知
            if tool_name == "TodoWrite" and session is not None:
                await _notify_todo_progress(input_data)

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
                thread_ts=thread_ts,
            )
            decision = result.get("decision", "deny")

            # TASK-302: 統計記録
            if session is not None:
                session.stats.record_use(tool_name, decision)
                # TASK-306: 連続タイムアウト警告
                if decision == "timeout" and session.stats.consecutive_timeouts >= 3:
                    await _notify_timeout_warning()

            if decision == "answered":
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
            thread_ts=thread_ts,
        )
        decision = result.get("decision", "deny")
        reason = result.get("reason", "")

        # TASK-302: 統計記録
        if session is not None:
            effective_decision = decision
            if reason == "timeout":
                effective_decision = "timeout"
            file_path = input_data.get("file_path") or input_data.get("notebook_path")
            session.stats.record_use(tool_name, effective_decision, file_path=file_path)

            # TASK-306: 連続タイムアウト警告
            if effective_decision == "timeout" and session.stats.consecutive_timeouts >= 3:
                await _notify_timeout_warning()

        if decision == "allow":
            return PermissionResultAllow(updated_input=input_data)
        return PermissionResultDeny(
            message=result.get("reason", "Permission denied via Slack")
        )

    async def _notify_todo_progress(input_data: dict[str, Any]) -> None:
        """TASK-303: TodoList 進捗をSlackスレッドに通知する。スロットリング付き。"""
        nonlocal _todo_last_notify_time, _todo_progress_msg_ts

        if session is None:
            return

        now = time.time()
        if now - _todo_last_notify_time < _TODO_NOTIFY_MIN_INTERVAL:
            return

        todos = input_data.get("todos", [])
        if not todos:
            return

        from .slack_messages import todo_progress_blocks

        blocks = todo_progress_blocks(todos, session.session_id)
        if not blocks:
            return

        try:
            if _todo_progress_msg_ts is None:
                # 初回は新規投稿
                resp = await bot.post_message(
                    blocks=blocks,
                    text=f"Session {session.session_id} progress",
                    thread_ts=thread_ts,
                )
                _todo_progress_msg_ts = resp["ts"]
            else:
                # 2回目以降は既存メッセージを更新
                await bot.update_message(
                    ts=_todo_progress_msg_ts,
                    blocks=blocks,
                )
            _todo_last_notify_time = now
        except Exception:
            logger.warning("Failed to post todo progress for session %s",
                         session.session_id if session else "unknown")

    async def _notify_timeout_warning() -> None:
        """TASK-306: 連続タイムアウト警告。"""
        if session is None:
            return

        from .slack_messages import timeout_warning_blocks

        try:
            await bot.post_message(
                blocks=timeout_warning_blocks(
                    session.session_id,
                    session.stats.consecutive_timeouts,
                ),
                text=f"Timeout warning: session {session.session_id}",
                thread_ts=thread_ts,
            )
        except Exception:
            logger.warning("Failed to post timeout warning for session %s", session.session_id)

    return can_use_tool
