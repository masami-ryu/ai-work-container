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
    progress_placeholder_blocks,
    client_disconnected_blocks,
    interrupt_ack_blocks,
)

if TYPE_CHECKING:
    from .audit import AuditLog
    from .config import Config
    from .slack_bot import SlackBot

logger = logging.getLogger(__name__)

OUTPUT_BUFFER_MAX_LINES = 1000

# 連続タイムアウト警告の閾値
CONSECUTIVE_TIMEOUT_THRESHOLD = 3

# 割り込み後 receive_response() 終了待ちのタイムアウト（秒）
_INTERRUPT_RESPONSE_DRAIN_TIMEOUT = 30


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
    status: str = "running"  # running, completed, error, cancelled
    thread_ts: str | None = None
    task: asyncio.Task | None = None
    output_buffer: deque[str] = field(default_factory=lambda: deque(maxlen=OUTPUT_BUFFER_MAX_LINES))
    subscribers: list[asyncio.Queue[dict]] = field(default_factory=list)
    stats: ToolStats = field(default_factory=ToolStats)
    started_at: float = field(default_factory=time.time)
    error_message: str | None = None
    # TASK-101: SDK クライアントへの参照（割り込み指示で使用）
    client: Any = None
    # TASK-107: 割り込み指示キュー（サイズ上限は Config.interrupt_queue_maxsize で設定）
    interrupt_queue: asyncio.Queue[str] | None = None
    # TASK-108: 割り込み処理中の再入防止フラグ
    _interrupt_in_progress: bool = False
    # TASK-201: 最新の TodoList スナップショット（定期進捗通知に統合表示）
    last_todos: list[dict[str, Any]] | None = None
    # TASK-205: 進捗プレースホルダーメッセージの ts（通知音排除用）
    progress_msg_ts: str | None = None


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
        # TASK-104: スレッド→セッションマッピング（割り込み指示用）
        self._thread_to_session: dict[str, Session] = {}

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

        # TASK-107: 割り込みキューを Config のサイズ上限で初期化
        interrupt_queue: asyncio.Queue[str] = asyncio.Queue(
            maxsize=self._config.interrupt_queue_maxsize,
        )

        session = Session(
            session_id=session_id,
            prompt=prompt,
            cwd=effective_cwd,
            thread_ts=thread_ts,
            interrupt_queue=interrupt_queue,
        )
        self._sessions[session_id] = session

        # TASK-104: スレッド→セッションマッピングを登録
        self._thread_to_session[thread_ts] = session

        # TASK-205: 進捗プレースホルダーメッセージを投稿（通知音排除）
        try:
            placeholder_resp = await self._bot.post_message(
                blocks=progress_placeholder_blocks(),
                text=f"Session {session_id} progress",
                thread_ts=thread_ts,
            )
            session.progress_msg_ts = placeholder_resp["ts"]
        except Exception:
            logger.warning("Failed to post progress placeholder for session %s", session_id)

        # セッションタスクを起動
        session.task = asyncio.create_task(
            self._run_session(session),
            name=f"session-{session_id}",
        )

        logger.info("Session %s started (cwd=%s)", session_id, effective_cwd)
        return session

    async def _run_session(self, session: Session) -> None:
        """セッション内で Claude SDK クライアントを実行する。

        割り込み指示対応のループ構造:
        - receive_response() と interrupt_queue.get() を asyncio.wait() で並行監視
        - 割り込み検出時: interrupt() → receive_response() の自然終了を待機 → query() で再開

        SDK interrupt() 動作パターン（確認済み）:
        - interrupt() は制御チャネルで中断信号を送信し、CLI の応答を待つ（最大60秒）
        - CLI は通常のメッセージストリームに ResultMessage を発行する
        - receive_response() は ResultMessage を受信して自然終了する（例外は発生しない）
        - 接続は維持されるため、続けて query() を呼び出し可能
        """
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
                # TASK-101: Session に SDK クライアント参照を保持
                session.client = client
                await client.query(session.prompt)

                # 割り込み対応ループ
                while True:
                    response_task = asyncio.create_task(
                        self._consume_responses(client, session),
                        name=f"response-{session.session_id}",
                    )
                    interrupt_task = asyncio.create_task(
                        session.interrupt_queue.get(),
                        name=f"interrupt-wait-{session.session_id}",
                    )

                    done, pending = await asyncio.wait(
                        {response_task, interrupt_task},
                        return_when=asyncio.FIRST_COMPLETED,
                    )

                    if interrupt_task in done:
                        new_instruction = interrupt_task.result()
                        session._interrupt_in_progress = True

                        try:
                            # SDK に中断を通知（CLI が ResultMessage を発行する）
                            await client.interrupt()

                            # receive_response() が ResultMessage で自然終了するのを待機
                            try:
                                await asyncio.wait_for(
                                    response_task, timeout=_INTERRUPT_RESPONSE_DRAIN_TIMEOUT
                                )
                            except asyncio.TimeoutError:
                                logger.warning(
                                    "Session %s: response drain timeout after interrupt, force cancelling",
                                    session.session_id,
                                )
                                response_task.cancel()
                                try:
                                    await response_task
                                except asyncio.CancelledError:
                                    pass
                            except Exception:
                                # 中断後の応答処理エラーは無視
                                pass

                            # 新しい指示を送信
                            await client.query(new_instruction)
                        finally:
                            session._interrupt_in_progress = False

                        continue  # ループ先頭で再度 receive_response + 監視を開始

                    if response_task in done:
                        # 正常完了（ResultMessage 到達）
                        interrupt_task.cancel()
                        # response_task で例外が発生していたら再送出
                        response_task.result()
                        break

                # クライアント参照をクリア
                session.client = None

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
            session.client = None

            # TASK-104: スレッド→セッションマッピングを解除
            if session.thread_ts and session.thread_ts in self._thread_to_session:
                del self._thread_to_session[session.thread_ts]

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

    async def _consume_responses(self, client: ClaudeSDKClient, session: Session) -> None:
        """receive_response() のメッセージをイテレートし出力を処理する。"""
        async for message in client.receive_response():
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        self._emit_output(session, block.text)

    async def _periodic_progress(self, session: Session) -> None:
        """TASK-304: 定期的な進捗ステータス通知。

        TASK-205/206: 通知音排除対応。
        - session.progress_msg_ts が設定済みの場合（プレースホルダー投稿成功時）は
          常に chat_update で更新し、chat_postMessage を呼ばない。
        - progress_msg_ts が None の場合（フォールバック）は従来通り chat_postMessage で初回投稿。
        TASK-201: TodoList 状態を進捗通知に統合表示。
        TASK-203: 進捗間隔は Config.progress_interval_sec で設定可能。
        """
        interval = self._config.progress_interval_sec

        try:
            # 最初の通知は interval 後
            await asyncio.sleep(interval)

            while session.status == "running":
                duration = time.time() - session.started_at
                blocks = periodic_progress_blocks(
                    session_id=session.session_id,
                    duration_sec=duration,
                    tool_uses=session.stats.total_uses,
                    last_tool=session.stats.last_tool,
                    todos=session.last_todos,
                )

                try:
                    if session.progress_msg_ts is not None:
                        # TASK-206: プレースホルダーが存在する場合は常に chat_update
                        await self._bot.update_message(
                            ts=session.progress_msg_ts,
                            blocks=blocks,
                        )
                    else:
                        # フォールバック: プレースホルダー投稿失敗時は新規投稿
                        resp = await self._bot.post_message(
                            blocks=blocks,
                            text=f"Session {session.session_id} progress",
                            thread_ts=session.thread_ts,
                        )
                        session.progress_msg_ts = resp["ts"]
                except Exception:
                    logger.warning("Failed to update periodic progress for session %s", session.session_id)

                await asyncio.sleep(interval)
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

    def get_session_by_thread(self, thread_ts: str) -> Session | None:
        """TASK-104: スレッド ts からセッションを取得する。"""
        return self._thread_to_session.get(thread_ts)

    def enqueue_interrupt(self, session: Session, instruction: str) -> None:
        """TASK-107: 割り込み指示をキューに投入する（latest-only ポリシー）。"""
        if session.interrupt_queue is None:
            return
        try:
            session.interrupt_queue.put_nowait(instruction)
        except asyncio.QueueFull:
            # 上限到達時は最古のエントリを破棄して最新を投入
            try:
                session.interrupt_queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                session.interrupt_queue.put_nowait(instruction)
            except asyncio.QueueFull:
                logger.warning("Failed to enqueue interrupt for session %s", session.session_id)

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
