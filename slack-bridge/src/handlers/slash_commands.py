"""スラッシュコマンドハンドラ: /claude, /claude-status, /claude-stop"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any, NamedTuple

if TYPE_CHECKING:
    from slack_bolt.app.async_app import AsyncApp
    from ..audit import AuditLog
    from ..config import Config
    from ..session import SessionManager

logger = logging.getLogger(__name__)


class ParsedArgs(NamedTuple):
    """TASK-301: /claude コマンドの解析結果。"""
    prompt: str
    cwd: str | None


def _parse_claude_args(text: str) -> ParsedArgs:
    """TASK-301: /claude のテキストから --cwd オプションを解析する。

    書式: /claude --cwd <path> <prompt> または /claude <prompt>
    先頭トークンが --cwd の場合のみオプションとして扱う。
    空白を含むパスは非対応（シンプルさを優先）。
    """
    stripped = text.strip()
    if not stripped.startswith("--cwd"):
        return ParsedArgs(prompt=stripped, cwd=None)

    # "--cwd" を除去
    rest = stripped[5:].lstrip()
    if not rest:
        # "--cwd" のみ（path も prompt もない）
        return ParsedArgs(prompt="", cwd=None)

    # 次のトークンを path として取得
    parts = rest.split(None, 1)
    cwd = parts[0]
    prompt = parts[1].strip() if len(parts) > 1 else ""
    return ParsedArgs(prompt=prompt, cwd=cwd)


def _check_channel(command: dict, config: Any) -> bool:
    """コマンドのチャンネルが設定チャンネルと一致するか検証する。"""
    channel_name = command.get("channel_name", "")
    channel_id = command.get("channel_id", "")
    configured = config.slack_channel

    # channel_name 比較: # プレフィックスを除去して比較
    if channel_name.lstrip("#") == configured.lstrip("#"):
        return True
    # channel_id 比較
    if channel_id == configured:
        return True
    return False


def register_slash_command_handlers(
    app: AsyncApp,
    session_manager: SessionManager,
    bot: Any,
    config: Any,
    audit: AuditLog,
) -> None:
    """スラッシュコマンドハンドラを登録する。"""

    @app.command("/claude")
    async def on_claude(ack, command, respond):
        await ack()

        user_id = command["user_id"]

        # 認可チェック
        if user_id != config.slack_approver_user_id:
            audit.record(
                correlation_id="slash_claude",
                request_type="slash_command",
                tool_name="/claude",
                decision="rejected_user",
                responder_user_id=user_id,
            )
            logger.warning("Rejected /claude from unauthorized user %s", user_id)
            await respond(
                text="🚫 You are not authorized to use this command.",
                response_type="ephemeral",
            )
            return

        # チャンネル検証
        if not _check_channel(command, config):
            await respond(
                text=f"🚫 This command can only be used in #{config.slack_channel.lstrip('#')}",
                response_type="ephemeral",
            )
            return

        # TASK-301: --cwd オプション解析
        raw_text = command.get("text", "").strip()
        parsed = _parse_claude_args(raw_text)
        prompt = parsed.prompt
        cwd = parsed.cwd

        if not prompt:
            await respond(
                text="Usage: /claude [--cwd <path>] <prompt>",
                response_type="ephemeral",
            )
            return

        # TASK-302/303: cwd 指定時のパス検証
        effective_cwd = config.default_cwd
        if cwd is not None:
            resolved = Path(cwd).resolve()
            if not resolved.exists():
                await respond(
                    text=f"🚫 Directory not found: {resolved}",
                    response_type="ephemeral",
                )
                return
            if not resolved.is_dir():
                await respond(
                    text=f"🚫 Not a directory: {resolved}",
                    response_type="ephemeral",
                )
                return
            effective_cwd = str(resolved)

        # 監査ログ記録
        audit.record(
            correlation_id="slash_claude",
            request_type="slash_command",
            tool_name="/claude",
            decision="accepted",
            responder_user_id=user_id,
            summary=prompt[:200],
            session_id=f"cwd={effective_cwd}",
        )

        # 非同期でセッション開始
        async def _start_session():
            try:
                await session_manager.start_session(
                    prompt=prompt,
                    cwd=effective_cwd,
                )
            except Exception:
                logger.exception("Failed to start session from /claude")
                await bot.post_ephemeral(
                    channel=command["channel_id"],
                    user=user_id,
                    text="❌ Failed to start session. Please check server logs.",
                )

        asyncio.create_task(_start_session())

    @app.command("/claude-status")
    async def on_claude_status(ack, command, respond):
        await ack()

        user_id = command["user_id"]

        # 認可チェック
        if user_id != config.slack_approver_user_id:
            audit.record(
                correlation_id="slash_claude_status",
                request_type="slash_command",
                tool_name="/claude-status",
                decision="rejected_user",
                responder_user_id=user_id,
            )
            logger.warning("Rejected /claude-status from unauthorized user %s", user_id)
            await respond(
                text="🚫 You are not authorized to use this command.",
                response_type="ephemeral",
            )
            return

        # 監査ログ記録
        audit.record(
            correlation_id="slash_claude_status",
            request_type="slash_command",
            tool_name="/claude-status",
            decision="accepted",
            responder_user_id=user_id,
        )

        sessions = session_manager.list_running_sessions()
        if not sessions:
            await respond(
                text="No active sessions.",
                response_type="ephemeral",
            )
            return

        lines = ["*Active Sessions:*"]
        for s in sessions:
            prompt_short = s["prompt"][:60]
            lines.append(f"• `{s['session_id']}` — {prompt_short}")

        await respond(
            text="\n".join(lines),
            response_type="ephemeral",
        )

    @app.command("/claude-stop")
    async def on_claude_stop(ack, command, respond):
        await ack()

        user_id = command["user_id"]

        # 認可チェック
        if user_id != config.slack_approver_user_id:
            audit.record(
                correlation_id="slash_claude_stop",
                request_type="slash_command",
                tool_name="/claude-stop",
                decision="rejected_user",
                responder_user_id=user_id,
            )
            logger.warning("Rejected /claude-stop from unauthorized user %s", user_id)
            await respond(
                text="🚫 You are not authorized to use this command.",
                response_type="ephemeral",
            )
            return

        session_id = command.get("text", "").strip()
        if not session_id:
            await respond(
                text="Usage: /claude-stop <session_id>",
                response_type="ephemeral",
            )
            return

        # 監査ログ記録
        audit.record(
            correlation_id="slash_claude_stop",
            request_type="slash_command",
            tool_name="/claude-stop",
            decision="accepted",
            responder_user_id=user_id,
            summary=f"stop session {session_id}",
        )

        result = await session_manager.stop_session(session_id)
        await respond(
            text=result,
            response_type="ephemeral",
        )
