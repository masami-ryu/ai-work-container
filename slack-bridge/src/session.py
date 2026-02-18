"""セッション管理: 複数 Claude セッションのライフサイクルと出力バッファを管理"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, TYPE_CHECKING

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, AssistantMessage, TextBlock

from .bridge import RequestBridge
from .permission_handler import create_permission_callback
from .slack_messages import (
    session_start_blocks,
    session_end_blocks,
    error_alert_blocks,
    timeout_warning_blocks,
    periodic_progress_blocks,
    client_disconnected_blocks,
)

if TYPE_CHECKING:
    from .audit import AuditLog
    from .config import Config
    from .slack_bot import SlackBot

logger = logging.getLogger(__name__)

OUTPUT_BUFFER_MAX_LINES = 1000

# 定期進捗通知の間隔（秒）
PERIODIC_PROGRESS_INTERVAL = 120  # 2分

# 連続タイムアウト警告の閾値
CONSECUTIVE_TIMEOUT_THRESHOLD = 3


@dataclass
class ToolStats:
    """TASK-301: セッションのツール使用統計。"""
    total_uses: int = 0
    allowed: int = 0
    denied: int = 0
    auto_allowed: int = 0
    timeouts: int = 0
    consecutive_timeouts: int = 0
    changed_files: list[str] = field(default_factory=list)
    last_tool: str | None = None
    tool_counts: dict[str, int] = field(default_factory=dict)

    def record_use(self, tool_name: str, decision: str, file_path: str | None = None) -> None:
        """ツール使用を記録する。"""
        self.total_uses += 1
        self.last_tool = tool_name
        self.tool_counts[tool_name] = self.tool_counts.get(tool_name, 0) + 1

        if decision == "auto_allow":
            self.auto_allowed += 1
        elif decision == "allow":
            self.allowed += 1
            # 変更ファイルを追跡
            if file_path and tool_name in ("Write", "Edit", "NotebookEdit"):
                if file_path not in self.changed_files:
                    self.changed_files.append(file_path)
        elif decision == "deny":
            self.denied += 1
        elif decision == "timeout":
            self.timeouts += 1
            self.consecutive_timeouts += 1
        else:
            self.denied += 1

        # タイムアウト以外の応答でカウンタリセット
        if decision != "timeout":
            self.consecutive_timeouts = 0

    def to_dict(self) -> dict[str, Any]:
        """統計情報を辞書で返す。"""
        return {
            "total_uses": self.total_uses,
            "allowed": self.allowed,
            "denied": self.denied,
            "auto_allowed": self.auto_allowed,
            "timeouts": self.timeouts,
        }


@dataclass
class Session:
    session_id: str
    prompt: str
    cwd: str
    status: str = "running"  # running, completed, error
    thread_ts: str | None = None
    task: asyncio.Task | None = None
    output_buffer: deque[str] = field(default_factory=lambda: deque(maxlen=OUTPUT_BUFFER_MAX_LINES))
    subscribers: list[asyncio.Queue[dict]] = field(default_factory=list)
    stats: ToolStats = field(default_factory=ToolStats)
    started_at: float = field(default_factory=time.time)
    error_message: str | None = None


class SessionManager:
    """複数の Claude セッションを管理する。"""

    def __init__(
        self,
        bot: SlackBot,
        bridge: RequestBridge,
        config: Config,
        audit: AuditLog,
    ) -> None:
        self._bot = bot
        self._bridge = bridge
        self._config = config
        self._audit = audit
        self._sessions: dict[str, Session] = {}
        # スレッド→質問マッピング: thread_ts → [{cid, question_index, message_ts}]
        self._thread_questions: dict[str, list[dict]] = {}

    async def start_session(
        self, prompt: str, cwd: str | None = None
    ) -> Session:
        """新しいセッションを開始し、Slack にスレッド親メッセージを投稿する。"""
        session_id = uuid.uuid4().hex[:8]
        effective_cwd = cwd or "."

        # Slack にセッション開始メッセージを投稿（スレッド親）
        blocks = session_start_blocks(prompt, effective_cwd, session_id)
        resp = await self._bot.post_message(
            blocks=blocks,
            text=f"[Session {session_id}] {prompt[:80]}",
        )
        thread_ts = resp["ts"]

        session = Session(
            session_id=session_id,
            prompt=prompt,
            cwd=effective_cwd,
            thread_ts=thread_ts,
        )
        self._sessions[session_id] = session

        # セッションタスクを起動
        session.task = asyncio.create_task(
            self._run_session(session),
            name=f"session-{session_id}",
        )

        logger.info("Session %s started (cwd=%s)", session_id, effective_cwd)
        return session

    async def _run_session(self, session: Session) -> None:
        """セッション内で Claude SDK クライアントを実行する。"""
        # TASK-304: 定期進捗通知タスク
        progress_task = asyncio.create_task(
            self._periodic_progress(session),
            name=f"progress-{session.session_id}",
        )

        try:
            # TASK-302: セッション固有の permission callback を生成（session 参照を渡す）
            can_use_tool = create_permission_callback(
                bridge=self._bridge,
                bot=self._bot,
                config=self._config,
                audit=self._audit,
                thread_ts=session.thread_ts,
                session=session,
                session_manager=self,
            )

            options = ClaudeAgentOptions(
                setting_sources=["project"],
                can_use_tool=can_use_tool,
                cwd=session.cwd,
            )

            async with ClaudeSDKClient(options=options) as client:
                await client.query(session.prompt)
                async for message in client.receive_response():
                    if isinstance(message, AssistantMessage):
                        for block in message.content:
                            if isinstance(block, TextBlock):
                                self._emit_output(session, block.text)

            session.status = "completed"
            self._emit_event(session, {"type": "completed", "session_id": session.session_id})

        except asyncio.CancelledError:
            session.status = "cancelled"
            self._emit_event(session, {
                "type": "error",
                "session_id": session.session_id,
                "message": "Session cancelled",
                "code": 1,
            })
            raise

        except Exception as e:
            session.status = "error"
            session.error_message = str(e)
            logger.exception("Session %s failed", session.session_id)
            self._emit_event(session, {
                "type": "error",
                "session_id": session.session_id,
                "message": str(e),
                "code": 1,
            })

            # TASK-306: エラー時にチャンネル通知
            try:
                await self._bot.post_message(
                    blocks=error_alert_blocks(session.session_id, str(e)),
                    text=f"Error in session {session.session_id}",
                    thread_ts=session.thread_ts,
                )
            except Exception:
                logger.exception("Failed to post error alert")

        finally:
            # 定期進捗通知タスクをキャンセル
            progress_task.cancel()
            try:
                await progress_task
            except asyncio.CancelledError:
                pass

            # TASK-305: Slack スレッドにリッチサマリ完了メッセージを投稿
            try:
                duration = time.time() - session.started_at
                blocks = session_end_blocks(
                    session.session_id,
                    session.status,
                    duration_sec=duration,
                    tool_stats=session.stats.to_dict(),
                    changed_files=session.stats.changed_files or None,
                    error_message=session.error_message,
                )
                await self._bot.post_message(
                    blocks=blocks,
                    text=f"Session {session.session_id} {session.status}",
                    thread_ts=session.thread_ts,
                )
            except Exception:
                logger.exception("Failed to post session end message")

    async def _periodic_progress(self, session: Session) -> None:
        """TASK-304: 定期的な進捗ステータス通知。

        既存メッセージを編集更新する方式でスレッド内のメッセージ増加を抑制する。
        """
        progress_msg_ts: str | None = None

        try:
            # 最初の通知は PERIODIC_PROGRESS_INTERVAL 後
            await asyncio.sleep(PERIODIC_PROGRESS_INTERVAL)

            while session.status == "running":
                duration = time.time() - session.started_at
                blocks = periodic_progress_blocks(
                    session_id=session.session_id,
                    duration_sec=duration,
                    tool_uses=session.stats.total_uses,
                    last_tool=session.stats.last_tool,
                )

                try:
                    if progress_msg_ts is None:
                        # 初回は新規投稿
                        resp = await self._bot.post_message(
                            blocks=blocks,
                            text=f"Session {session.session_id} progress",
                            thread_ts=session.thread_ts,
                        )
                        progress_msg_ts = resp["ts"]
                    else:
                        # 2回目以降は既存メッセージを更新
                        await self._bot.update_message(
                            ts=progress_msg_ts,
                            blocks=blocks,
                        )
                except Exception:
                    logger.warning("Failed to update periodic progress for session %s", session.session_id)

                await asyncio.sleep(PERIODIC_PROGRESS_INTERVAL)
        except asyncio.CancelledError:
            pass

    def _emit_output(self, session: Session, text: str) -> None:
        """出力をバッファに蓄積し、購読者にイベントを配信する。"""
        for line in text.splitlines(keepends=True):
            session.output_buffer.append(line)
        event = {
            "type": "output",
            "session_id": session.session_id,
            "text": text,
        }
        self._emit_event(session, event)

    def _emit_event(self, session: Session, event: dict) -> None:
        """購読者にイベントを配信する。"""
        for queue in session.subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                pass

    def get_output_tail(self, session_id: str, tail: int = 100) -> list[str]:
        """過去バッファから指定行数を取得する。"""
        session = self._sessions.get(session_id)
        if session is None:
            return []
        buf = list(session.output_buffer)
        return buf[-tail:] if tail > 0 else []

    async def subscribe_events(self, session_id: str) -> AsyncIterator[dict]:
        """セッションのリアルタイムイベントを購読する。"""
        session = self._sessions.get(session_id)
        if session is None:
            yield {"type": "error", "session_id": session_id, "message": "Session not found", "code": 1}
            return

        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=1000)
        session.subscribers.append(queue)
        try:
            while True:
                event = await queue.get()
                yield event
                if event["type"] in ("completed", "error"):
                    break
        finally:
            session.subscribers.remove(queue)

    def list_sessions(self) -> list[dict]:
        """アクティブセッション一覧を返す。"""
        return [
            {
                "session_id": s.session_id,
                "status": s.status,
                "prompt": s.prompt,
                "cwd": s.cwd,
                "thread_ts": s.thread_ts,
            }
            for s in self._sessions.values()
        ]

    def list_running_sessions(self) -> list[dict]:
        """status == "running" のセッション一覧を返す。"""
        return [
            {
                "session_id": s.session_id,
                "status": s.status,
                "prompt": s.prompt,
                "cwd": s.cwd,
                "thread_ts": s.thread_ts,
            }
            for s in self._sessions.values()
            if s.status == "running"
        ]

    async def stop_session(self, session_id: str) -> str:
        """セッションを停止する。結果メッセージを返す。"""
        session = self._sessions.get(session_id)
        if session is None:
            return f"Session '{session_id}' not found."

        if session.task is None or session.task.done():
            return f"Session '{session_id}' is already finished (status: {session.status})."

        session.task.cancel()
        try:
            await session.task
        except asyncio.CancelledError:
            pass

        return f"Session '{session_id}' has been stopped."

    def register_thread_question(
        self, thread_ts: str, cid: str, question_index: int, message_ts: str,
    ) -> None:
        """スレッド→質問マッピングを登録する。"""
        entries = self._thread_questions.setdefault(thread_ts, [])
        entries.append({
            "cid": cid,
            "question_index": question_index,
            "message_ts": message_ts,
        })

    def get_pending_questions_for_thread(self, thread_ts: str) -> list[dict]:
        """スレッドの未回答質問リストを返す。"""
        return list(self._thread_questions.get(thread_ts, []))

    def unregister_thread_question(
        self, thread_ts: str, cid: str, question_index: int,
    ) -> None:
        """特定質問のマッピングのみ解放する。"""
        entries = self._thread_questions.get(thread_ts)
        if entries is None:
            return
        self._thread_questions[thread_ts] = [
            e for e in entries
            if not (e["cid"] == cid and e["question_index"] == question_index)
        ]
        if not self._thread_questions[thread_ts]:
            del self._thread_questions[thread_ts]

    def unregister_thread_questions(self, cid: str) -> None:
        """指定 cid の全質問マッピングを解放する。"""
        for thread_ts in list(self._thread_questions.keys()):
            self._thread_questions[thread_ts] = [
                e for e in self._thread_questions[thread_ts]
                if e["cid"] != cid
            ]
            if not self._thread_questions[thread_ts]:
                del self._thread_questions[thread_ts]

    async def notify_client_disconnected(self, session_id: str) -> None:
        """TASK-603: CLI クライアント切断時に Slack スレッドに通知を投稿する。"""
        session = self._sessions.get(session_id)
        if session is None:
            return
        try:
            blocks = client_disconnected_blocks(session_id)
            await self._bot.post_message(
                blocks=blocks,
                text=f"CLI disconnected for session {session_id}",
                thread_ts=session.thread_ts,
            )
        except Exception:
            logger.warning("Failed to post client disconnect notification for session %s", session_id)

    async def shutdown(self) -> None:
        """全セッションを停止する。"""
        # 全 pending リクエストを deny
        await self._bridge.shutdown()

        # 全セッションタスクをキャンセル
        tasks = []
        for session in self._sessions.values():
            if session.task and not session.task.done():
                session.task.cancel()
                tasks.append(session.task)

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        # 全セッションの完了メッセージを投稿
        for session in self._sessions.values():
            if session.status == "running":
                session.status = "cancelled"
                try:
                    blocks = session_end_blocks(session.session_id, "cancelled")
                    await self._bot.post_message(
                        blocks=blocks,
                        text=f"Session {session.session_id} cancelled",
                        thread_ts=session.thread_ts,
                    )
                except Exception:
                    pass

        logger.info("SessionManager shutdown complete (%d sessions)", len(self._sessions))
