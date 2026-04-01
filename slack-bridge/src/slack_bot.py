"""Slack Bot 基盤: AsyncApp + Socket Mode"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable, Coroutine, TYPE_CHECKING

from slack_bolt.app.async_app import AsyncApp
from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

if TYPE_CHECKING:
    from .bridge import RequestBridge
    from .audit import AuditLog
    from .config import Config
    from .session import SessionManager

logger = logging.getLogger(__name__)

# リトライ設定
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0  # 秒

# Socket Mode 再接続設定（P2-001）
# NOTE: slack-bolt ライブラリには組み込みの自動再接続機能（auto_reconnect_enabled=True）が
# デフォルトで有効化されている。以下の設定はライブラリの再接続が失敗し続けた場合の
# 追加監視レイヤーとして機能する。
RECONNECT_MAX_RETRIES = 10
RECONNECT_BASE_DELAY = 1.0  # 秒（初回）
RECONNECT_MAX_DELAY = 60.0  # 秒（最大）
RECONNECT_TOTAL_TIMEOUT = 300.0  # 5分（総再接続時間上限）


class SlackAPIError(Exception):
    """Slack API 呼び出しが全リトライ後も失敗した場合のエラー。"""
    pass


class SlackBot:
    """Slack Bot の初期化とハンドラ登録を管理する。"""

    def __init__(
        self,
        config: Config,
        bridge: RequestBridge,
        audit: AuditLog,
        on_fatal_disconnect: Callable[[], Coroutine[Any, Any, None]] | None = None,
    ) -> None:
        self.config = config
        self.bridge = bridge
        self.audit = audit
        self.app = AsyncApp(token=config.slack_bot_token)
        self._handler: AsyncSocketModeHandler | None = None
        self._session_manager: SessionManager | None = None
        # P2-003: 致命的切断時のコールバック
        self._on_fatal_disconnect = on_fatal_disconnect
        # P2-002: 再接続中フラグ（重複再接続防止）
        self._reconnecting = False
        # P2-001: 切断カウンタ
        self._disconnect_count = 0
        self._last_connected_at: float | None = None
        self._register_handlers()

    def _register_handlers(self) -> None:
        from .handlers.permission import register_permission_handlers
        from .handlers.ask_question import register_ask_handlers

        register_permission_handlers(
            app=self.app,
            bridge=self.bridge,
            audit=self.audit,
            config=self.config,
            bot=self,
        )
        register_ask_handlers(
            app=self.app,
            bridge=self.bridge,
            audit=self.audit,
            config=self.config,
            bot=self,
        )

    def set_session_manager(self, session_manager: SessionManager) -> None:
        """SessionManager を注入し、セッション依存ハンドラを登録する。"""
        if self._session_manager is not None:
            raise RuntimeError("set_session_manager() has already been called")
        self._session_manager = session_manager
        self._register_session_handlers()

    def _register_session_handlers(self) -> None:
        """SessionManager 依存のハンドラ（スラッシュコマンド・スレッド返信）を登録する。"""
        from .handlers.slash_commands import register_slash_command_handlers
        from .handlers.thread_reply import register_thread_reply_handler

        register_slash_command_handlers(
            app=self.app,
            session_manager=self._session_manager,
            bot=self,
            config=self.config,
            audit=self.audit,
        )
        register_thread_reply_handler(
            app=self.app,
            session_manager=self._session_manager,
            bridge=self.bridge,
            bot=self,
            config=self.config,
            audit=self.audit,
        )

    async def start(self) -> None:
        if self._session_manager is None:
            raise RuntimeError(
                "set_session_manager() must be called before start()"
            )
        self._handler = AsyncSocketModeHandler(
            self.app, self.config.slack_app_token
        )

        # P2-001: Socket Mode 接続イベントリスナーを登録
        # NOTE: slack-bolt の on_close/on_error リスナーは WSMessage を引数に取る async 関数
        async def _on_close(message: Any) -> None:
            self._disconnect_count += 1
            logger.warning(
                "Socket Mode connection closed (disconnect #%d)",
                self._disconnect_count,
            )
            # ライブラリの組み込み再接続が失敗し続けた場合のフォールバック監視
            asyncio.create_task(self._monitor_reconnection())

        async def _on_error(message: Any) -> None:
            logger.warning("Socket Mode connection error: %s", message)

        self._handler.client.on_close_listeners.append(_on_close)
        self._handler.client.on_error_listeners.append(_on_error)

        await self._handler.connect_async()
        self._last_connected_at = time.time()
        logger.info("Slack Socket Mode connected")

    async def _monitor_reconnection(self) -> None:
        """P2-001/P2-002: ライブラリの再接続を監視し、失敗時にフォールバック再接続を試行する。

        slack-bolt の組み込み auto_reconnect が動作していれば通常はこのメソッドの
        再接続ロジックには到達しない。ライブラリの再接続が完全に失敗した場合のセーフティネット。
        """
        # P2-002: 重複再接続を防止
        if self._reconnecting:
            logger.debug("Reconnection already in progress, skipping")
            return
        self._reconnecting = True

        try:
            # ライブラリの自動再接続を待つ（10秒間）
            for _ in range(5):
                await asyncio.sleep(2)
                if self._handler and await self._is_connected():
                    logger.info("Socket Mode reconnected (by library auto-reconnect)")
                    self._last_connected_at = time.time()
                    await self._notify_reconnect_success()
                    return

            # ライブラリの再接続が失敗 → フォールバック再接続を試行
            logger.warning("Library auto-reconnect failed, attempting manual reconnection")
            start_time = time.time()

            for attempt in range(RECONNECT_MAX_RETRIES):
                elapsed = time.time() - start_time
                if elapsed > RECONNECT_TOTAL_TIMEOUT:
                    logger.error(
                        "Reconnection total timeout exceeded (%.0fs > %.0fs)",
                        elapsed, RECONNECT_TOTAL_TIMEOUT,
                    )
                    break

                delay = min(RECONNECT_BASE_DELAY * (2 ** attempt), RECONNECT_MAX_DELAY)
                logger.info(
                    "Reconnection attempt %d/%d (delay: %.1fs)",
                    attempt + 1, RECONNECT_MAX_RETRIES, delay,
                )
                await asyncio.sleep(delay)

                try:
                    if self._handler:
                        await self._handler.client.connect()
                        if await self._is_connected():
                            logger.info("Socket Mode reconnected (manual attempt %d)", attempt + 1)
                            self._last_connected_at = time.time()
                            await self._notify_reconnect_success()
                            return
                except Exception as e:
                    logger.warning("Reconnection attempt %d failed: %s", attempt + 1, e)

            # 全リトライ失敗 → 致命的切断
            logger.error("All reconnection attempts failed")
            await self._notify_reconnect_failure()

            # P2-003: 致命的切断時コールバックを発火
            if self._on_fatal_disconnect is not None:
                logger.info("Invoking fatal disconnect callback")
                await self._on_fatal_disconnect()

        finally:
            self._reconnecting = False

    async def _is_connected(self) -> bool:
        """Socket Mode 接続が有効かを確認する。"""
        if self._handler is None:
            return False
        try:
            return await self._handler.client.is_connected()
        except Exception:
            return False

    async def _notify_reconnect_success(self) -> None:
        """P2-004: 再接続成功を Slack チャンネルに通知する。"""
        from .slack_messages import reconnect_success_blocks
        try:
            await self.post_message(
                blocks=reconnect_success_blocks(self._disconnect_count),
                text="Socket Mode reconnected",
            )
        except Exception:
            logger.warning("Failed to notify reconnect success")

    async def _notify_reconnect_failure(self) -> None:
        """P2-004: 再接続失敗を Slack チャンネルに通知する。"""
        from .slack_messages import reconnect_failure_blocks
        try:
            await self.post_message(
                blocks=reconnect_failure_blocks(self._disconnect_count),
                text="Socket Mode reconnection failed - daemon shutting down",
            )
        except Exception:
            logger.warning("Failed to notify reconnect failure")

    async def stop(self) -> None:
        if self._handler:
            await self._handler.close_async()
            logger.info("Slack Socket Mode disconnected")

    async def post_message(
        self, *, blocks: list[dict], text: str = "", thread_ts: str | None = None
    ) -> dict:
        kwargs: dict = {
            "channel": self.config.slack_channel,
            "blocks": blocks,
            "text": text or "Approval required",
        }
        if thread_ts is not None:
            kwargs["thread_ts"] = thread_ts
        resp = await self._retry_api_call(self.app.client.chat_postMessage, **kwargs)
        return resp

    async def update_message(
        self, *, ts: str, blocks: list[dict], text: str = "",
        channel: str | None = None,
    ) -> None:
        await self._retry_api_call(
            self.app.client.chat_update,
            channel=channel or self.config.slack_channel,
            ts=ts,
            blocks=blocks,
            text=text or "Updated",
        )

    async def post_ephemeral(
        self, *, channel: str, user: str, text: str, thread_ts: str | None = None
    ) -> None:
        """Ephemeral メッセージを投稿する。"""
        kwargs: dict = {
            "channel": channel,
            "user": user,
            "text": text,
        }
        if thread_ts is not None:
            kwargs["thread_ts"] = thread_ts
        await self._retry_api_call(self.app.client.chat_postEphemeral, **kwargs)

    async def _retry_api_call(self, api_method, **kwargs):
        """Slack API 呼び出しをリトライ付きで実行する。

        最大 MAX_RETRIES 回リトライし、指数バックオフで待機する。
        全リトライ失敗時は SlackAPIError を送出する。
        """
        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                return await api_method(**kwargs)
            except Exception as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning(
                        "Slack API call failed (attempt %d/%d): %s. Retrying in %.1fs",
                        attempt + 1, MAX_RETRIES, e, delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(
                        "Slack API call failed after %d attempts: %s",
                        MAX_RETRIES, e,
                    )
        raise SlackAPIError(
            f"Slack API call failed after {MAX_RETRIES} retries: {last_error}"
        ) from last_error
