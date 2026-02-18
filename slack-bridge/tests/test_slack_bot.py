"""SlackBot のユニットテスト (TASK-504: Slack API error handling)"""

from __future__ import annotations

import asyncio

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.slack_bot import SlackBot, SlackAPIError, MAX_RETRIES
from src.bridge import RequestBridge
from src.audit import AuditLog
from src.config import Config


@pytest.fixture
def config():
    return Config(
        slack_app_token="xapp-1-ABC123-456-DEF789",
        slack_bot_token="xoxb-111-222-ABC333",
        slack_channel="CTESTCHANNEL",
        slack_approver_user_id="UAPPROVER01",
    )


@pytest.fixture
def bridge():
    return RequestBridge()


@pytest.fixture
def audit(tmp_path):
    return AuditLog(db_path=tmp_path / "test_audit.db")


@pytest.fixture
def bot(config, bridge, audit):
    """AsyncApp と _register_handlers をモックして SlackBot を生成する。"""
    with (
        patch("src.slack_bot.AsyncApp") as MockApp,
        patch.object(SlackBot, "_register_handlers"),
    ):
        mock_app = MagicMock()
        mock_app.client = MagicMock()
        mock_app.client.chat_postMessage = AsyncMock()
        mock_app.client.chat_update = AsyncMock()
        mock_app.client.chat_postEphemeral = AsyncMock()
        MockApp.return_value = mock_app

        slack_bot = SlackBot(config=config, bridge=bridge, audit=audit)
        # MockApp の戻り値が正しく設定されていることを確認
        slack_bot.app = mock_app
        yield slack_bot


# TASK-504-01: _retry_api_call が1回目で成功する
@pytest.mark.asyncio
async def test_retry_api_call_succeeds_on_first_try(bot):
    api_method = AsyncMock(return_value={"ok": True, "ts": "1234.5678"})

    result = await bot._retry_api_call(api_method, channel="C123", text="hello")

    assert result == {"ok": True, "ts": "1234.5678"}
    api_method.assert_awaited_once_with(channel="C123", text="hello")


# TASK-504-02: _retry_api_call が1回失敗後、2回目で成功する
@pytest.mark.asyncio
async def test_retry_api_call_succeeds_on_second_try(bot):
    api_method = AsyncMock(
        side_effect=[RuntimeError("rate_limited"), {"ok": True, "ts": "1234.5678"}]
    )

    with patch("src.slack_bot.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
        result = await bot._retry_api_call(api_method, channel="C123")

    assert result == {"ok": True, "ts": "1234.5678"}
    assert api_method.await_count == 2
    # 1回目の失敗後に RETRY_BASE_DELAY * 2^0 = 1.0 秒待機
    mock_sleep.assert_awaited_once_with(1.0)


# TASK-504-03: _retry_api_call が MAX_RETRIES 回失敗後に SlackAPIError を送出する
@pytest.mark.asyncio
async def test_retry_api_call_raises_after_max_retries(bot):
    api_method = AsyncMock(side_effect=RuntimeError("server_error"))

    with patch("src.slack_bot.asyncio.sleep", new_callable=AsyncMock):
        with pytest.raises(SlackAPIError, match=f"after {MAX_RETRIES} retries"):
            await bot._retry_api_call(api_method, channel="C123")

    assert api_method.await_count == MAX_RETRIES


# TASK-504-04: post_message がリトライロジックを使用する
@pytest.mark.asyncio
async def test_post_message_uses_retry_logic(bot):
    bot.app.client.chat_postMessage = AsyncMock(
        side_effect=[
            RuntimeError("transient"),
            {"ok": True, "ts": "9999.0001"},
        ]
    )

    with patch("src.slack_bot.asyncio.sleep", new_callable=AsyncMock):
        result = await bot.post_message(
            blocks=[{"type": "section", "text": {"type": "mrkdwn", "text": "test"}}],
            text="test fallback",
        )

    assert result == {"ok": True, "ts": "9999.0001"}
    assert bot.app.client.chat_postMessage.await_count == 2
    # channel が config の値で呼び出される
    call_kwargs = bot.app.client.chat_postMessage.call_args_list[0].kwargs
    assert call_kwargs["channel"] == "CTESTCHANNEL"


# TASK-504-05: update_message がリトライロジックを使用する
@pytest.mark.asyncio
async def test_update_message_uses_retry_logic(bot):
    bot.app.client.chat_update = AsyncMock(
        side_effect=[
            RuntimeError("transient"),
            {"ok": True},
        ]
    )

    with patch("src.slack_bot.asyncio.sleep", new_callable=AsyncMock):
        await bot.update_message(
            ts="1234.5678",
            blocks=[{"type": "section", "text": {"type": "mrkdwn", "text": "updated"}}],
            text="updated fallback",
        )

    assert bot.app.client.chat_update.await_count == 2
    call_kwargs = bot.app.client.chat_update.call_args_list[0].kwargs
    assert call_kwargs["channel"] == "CTESTCHANNEL"
    assert call_kwargs["ts"] == "1234.5678"


# TASK-504-06: _retry_api_call の指数バックオフが正しい待機時間を使用する
@pytest.mark.asyncio
async def test_retry_exponential_backoff_delays(bot):
    api_method = AsyncMock(side_effect=RuntimeError("fail"))

    with patch("src.slack_bot.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
        with pytest.raises(SlackAPIError):
            await bot._retry_api_call(api_method, channel="C123")

    # MAX_RETRIES=3 の場合: 1回目失敗→sleep(1.0), 2回目失敗→sleep(2.0), 3回目失敗→例外
    assert mock_sleep.await_count == MAX_RETRIES - 1
    delays = [call.args[0] for call in mock_sleep.call_args_list]
    assert delays == [1.0, 2.0]


# TASK-504-07: post_message が thread_ts を正しく渡す
@pytest.mark.asyncio
async def test_post_message_with_thread_ts(bot):
    bot.app.client.chat_postMessage = AsyncMock(
        return_value={"ok": True, "ts": "1111.2222"}
    )

    result = await bot.post_message(
        blocks=[],
        text="threaded",
        thread_ts="parent_ts",
    )

    assert result == {"ok": True, "ts": "1111.2222"}
    call_kwargs = bot.app.client.chat_postMessage.call_args.kwargs
    assert call_kwargs["thread_ts"] == "parent_ts"


# TASK-504-08: post_message が thread_ts=None の場合にキーを含めない
@pytest.mark.asyncio
async def test_post_message_without_thread_ts(bot):
    bot.app.client.chat_postMessage = AsyncMock(
        return_value={"ok": True, "ts": "1111.3333"}
    )

    await bot.post_message(blocks=[], text="no thread")

    call_kwargs = bot.app.client.chat_postMessage.call_args.kwargs
    assert "thread_ts" not in call_kwargs


# TASK-504-09: SlackAPIError が元の例外を __cause__ として保持する
@pytest.mark.asyncio
async def test_slack_api_error_chains_original_exception(bot):
    original_error = ConnectionError("connection refused")
    api_method = AsyncMock(side_effect=original_error)

    with patch("src.slack_bot.asyncio.sleep", new_callable=AsyncMock):
        with pytest.raises(SlackAPIError) as exc_info:
            await bot._retry_api_call(api_method, channel="C123")

    assert exc_info.value.__cause__ is original_error


# TASK-103: Socket Mode 接続の健全性チェック
@pytest.mark.asyncio
async def test_socket_mode_close_and_error_listeners(bot):
    """start() で on_close_listeners / on_error_listeners にリスナーが登録される。"""
    import logging

    mock_handler = MagicMock()
    mock_client = MagicMock()
    mock_client.on_close_listeners = []
    mock_client.on_error_listeners = []
    mock_handler.client = mock_client
    mock_handler.connect_async = AsyncMock()

    # set_session_manager を呼んでおく
    mock_sm = MagicMock()
    with patch.object(bot, "_register_session_handlers"):
        bot.set_session_manager(mock_sm)

    with patch("src.slack_bot.AsyncSocketModeHandler", return_value=mock_handler):
        await bot.start()

    # リスナーが登録されていること
    assert len(mock_client.on_close_listeners) == 1
    assert len(mock_client.on_error_listeners) == 1

    # リスナーを呼び出してログが出ることを検証
    with patch("src.slack_bot.logger") as mock_logger:
        mock_client.on_close_listeners[0]()
        mock_logger.warning.assert_called_with("Socket Mode connection closed")

        mock_logger.reset_mock()
        mock_client.on_error_listeners[0](Exception("test error"))
        mock_logger.warning.assert_called_with("Socket Mode connection error")
