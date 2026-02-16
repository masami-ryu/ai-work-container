"""Slack Bot 基盤: AsyncApp + Socket Mode"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from slack_bolt.app.async_app import AsyncApp
from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

if TYPE_CHECKING:
    from .bridge import RequestBridge
    from .audit import AuditLog
    from .config import Config

logger = logging.getLogger(__name__)

# リトライ設定
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0  # 秒


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
    ) -> None:
        self.config = config
        self.bridge = bridge
        self.audit = audit
        self.app = AsyncApp(token=config.slack_bot_token)
        self._handler: AsyncSocketModeHandler | None = None
        self._register_handlers()

    def _register_handlers(self) -> None:
        from .handlers.permission import register_permission_handlers
        from .handlers.ask_question import register_ask_handlers

        register_permission_handlers(
            app=self.app,
            bridge=self.bridge,
            audit=self.audit,
            config=self.config,
        )
        register_ask_handlers(
            app=self.app,
            bridge=self.bridge,
            audit=self.audit,
            config=self.config,
        )

    async def start(self) -> None:
        self._handler = AsyncSocketModeHandler(
            self.app, self.config.slack_app_token
        )
        await self._handler.connect_async()
        logger.info("Slack Socket Mode connected")

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
        self, *, ts: str, blocks: list[dict], text: str = ""
    ) -> None:
        await self._retry_api_call(
            self.app.client.chat_update,
            channel=self.config.slack_channel,
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
