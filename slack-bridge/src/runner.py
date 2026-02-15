"""エントリポイント: Agent SDK + Slack Bot を同一 asyncio ループで起動"""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, AssistantMessage, TextBlock

from .config import load_config
from .bridge import RequestBridge
from .audit import AuditLog
from .slack_bot import SlackBot
from .permission_handler import create_permission_callback

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Slack Bridge for Claude Code")
    parser.add_argument("prompt", nargs="?", help="初回プロンプト")
    parser.add_argument("--fallback-stdin", action="store_true", default=False)
    return parser.parse_args()


async def run(args: argparse.Namespace) -> None:
    config = load_config(sys.argv[1:])
    bridge = RequestBridge()
    audit = AuditLog()
    bot = SlackBot(config=config, bridge=bridge, audit=audit)

    # シグナルハンドラ
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(
            sig,
            lambda: asyncio.create_task(_shutdown(bridge, bot)),
        )

    # Slack Bot 起動
    await bot.start()
    logger.info("Slack Bot started")

    # Agent SDK コールバック
    can_use_tool = create_permission_callback(
        bridge=bridge, bot=bot, config=config, audit=audit
    )

    options = ClaudeAgentOptions(
        setting_sources=["project"],
        can_use_tool=can_use_tool,
    )

    prompt = args.prompt
    if not prompt:
        prompt = input("Prompt: ")

    async with ClaudeSDKClient(options=options) as client:
        await client.query(prompt)
        async for message in client.receive_response():
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        print(block.text)

    await bot.stop()
    logger.info("Done")


async def _shutdown(bridge: RequestBridge, bot: SlackBot) -> None:
    logger.info("Shutting down...")
    await bridge.shutdown()
    await bot.stop()


def main() -> None:
    args = parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
