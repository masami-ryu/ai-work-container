"""Slack Bot 基盤: AsyncApp + Socket Mode"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from slack_bolt.app.async_app import AsyncApp
from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

if TYPE_CHECKING:
    from .bridge import RequestBridge
    from .audit import AuditLog
    from .config import Config

logger = logging.getLogger(__name__)


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
        self, *, blocks: list[dict], text: str = ""
    ) -> dict:
        resp = await self.app.client.chat_postMessage(
            channel=self.config.slack_channel,
            blocks=blocks,
            text=text or "Approval required",
        )
        return resp

    async def update_message(
        self, *, ts: str, blocks: list[dict], text: str = ""
    ) -> None:
        await self.app.client.chat_update(
            channel=self.config.slack_channel,
            ts=ts,
            blocks=blocks,
            text=text or "Updated",
        )
