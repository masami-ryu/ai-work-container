"""テスト共通ヘルパー"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from src.config import Config


# Config バリデーションを通過するテスト用デフォルト値
TEST_CONFIG_DEFAULTS = dict(
    slack_app_token="xapp-1-A0001-000-abc123",
    slack_bot_token="xoxb-111-222-abc123",
    slack_channel="test-channel",
    slack_approver_user_id="UAPPROVER01",
)


def make_config(**overrides) -> Config:
    """テスト用 Config オブジェクトを作成する。"""
    defaults = dict(TEST_CONFIG_DEFAULTS)
    defaults.update(overrides)
    return Config(**defaults)


def make_bot():
    """テスト用のモック SlackBot を作成する。"""
    bot = MagicMock()
    bot.post_message = AsyncMock(return_value={"ts": "1234.5678"})
    bot.update_message = AsyncMock()
    return bot
