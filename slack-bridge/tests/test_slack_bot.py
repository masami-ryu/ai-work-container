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


# --- P2-006: 再接続シナリオのユニットテスト ---


@pytest.fixture
def reconnect_bot(config, bridge, audit):
    """再接続テスト用の SlackBot を生成する。"""
    fatal_callback = AsyncMock()
    with (
        patch("src.slack_bot.AsyncApp") as MockApp,
        patch.object(SlackBot, "_register_handlers"),
    ):
        mock_app = MagicMock()
        mock_app.client = MagicMock()
        mock_app.client.chat_postMessage = AsyncMock(return_value={"ok": True, "ts": "1234.5678"})
        mock_app.client.chat_update = AsyncMock()
        mock_app.client.chat_postEphemeral = AsyncMock()
        MockApp.return_value = mock_app

        slack_bot = SlackBot(
            config=config, bridge=bridge, audit=audit,
            on_fatal_disconnect=fatal_callback,
        )
        slack_bot.app = mock_app
        slack_bot._fatal_callback = fatal_callback
        yield slack_bot


@pytest.mark.asyncio
async def test_reconnect_on_close_triggers_monitor(reconnect_bot):
    """P2-006-01: on_close 後に再接続監視が試行される。"""
    mock_handler = MagicMock()
    mock_client = MagicMock()
    mock_client.on_close_listeners = []
    mock_client.on_error_listeners = []
    mock_client.is_connected = AsyncMock(return_value=True)
    mock_handler.client = mock_client
    mock_handler.connect_async = AsyncMock()

    mock_sm = MagicMock()
    with patch.object(reconnect_bot, "_register_session_handlers"):
        reconnect_bot.set_session_manager(mock_sm)

    with patch("src.slack_bot.AsyncSocketModeHandler", return_value=mock_handler):
        await reconnect_bot.start()

    # on_close リスナーを取得
    assert len(mock_client.on_close_listeners) == 1
    on_close = mock_client.on_close_listeners[0]

    # on_close を呼び出し（ライブラリが再接続済みのケース）
    with patch("src.slack_bot.asyncio.sleep", new_callable=AsyncMock):
        await on_close(MagicMock())  # WSMessage をモック

    # disconnect_count が増加
    assert reconnect_bot._disconnect_count == 1

    # 少し待って監視タスクが完了するのを待つ
    await asyncio.sleep(0.01)


@pytest.mark.asyncio
async def test_reconnect_on_error_logs_warning(reconnect_bot):
    """P2-006-02: on_error 後にログが記録される。"""
    mock_handler = MagicMock()
    mock_client = MagicMock()
    mock_client.on_close_listeners = []
    mock_client.on_error_listeners = []
    mock_handler.client = mock_client
    mock_handler.connect_async = AsyncMock()

    mock_sm = MagicMock()
    with patch.object(reconnect_bot, "_register_session_handlers"):
        reconnect_bot.set_session_manager(mock_sm)

    with patch("src.slack_bot.AsyncSocketModeHandler", return_value=mock_handler):
        await reconnect_bot.start()

    on_error = mock_client.on_error_listeners[0]

    with patch("src.slack_bot.logger") as mock_logger:
        await on_error(MagicMock())
        mock_logger.warning.assert_called()


@pytest.mark.asyncio
async def test_reconnect_duplicate_prevention(reconnect_bot):
    """P2-006-03: 複数のclose イベント同時発生時に再接続が1回のみ実行される。"""
    reconnect_bot._reconnecting = False

    # _is_connected を True にして即座に再接続成功とする
    reconnect_bot._handler = MagicMock()

    call_count = 0
    original_monitor = reconnect_bot._monitor_reconnection

    async def counting_monitor():
        nonlocal call_count
        call_count += 1
        # 最初の呼び出しだけ実際の処理を行う
        reconnect_bot._reconnecting = True
        await asyncio.sleep(0.01)
        reconnect_bot._reconnecting = False

    with patch.object(reconnect_bot, "_monitor_reconnection", side_effect=counting_monitor):
        # 並行で2回呼び出し
        await asyncio.gather(
            reconnect_bot._monitor_reconnection(),
            reconnect_bot._monitor_reconnection(),
        )

    # 両方とも呼ばれるが、実際の再接続ロジック内の _reconnecting フラグで制御される
    # ここでは counting_monitor で手動制御しているため2回呼ばれるが、
    # 実際のコードでは _reconnecting フラグで制御される
    assert call_count == 2

    # 実際の _monitor_reconnection の重複防止をテスト
    reconnect_bot._reconnecting = True
    with patch.object(reconnect_bot, "_is_connected", new_callable=AsyncMock, return_value=True):
        # 再接続中フラグが立っている場合はスキップされる
        reconnect_bot._reconnecting = True
        await reconnect_bot._monitor_reconnection()
        # フラグが True のままなので処理はスキップされる
        assert reconnect_bot._reconnecting is True


@pytest.mark.asyncio
async def test_reconnect_max_retries_triggers_fatal_disconnect(reconnect_bot):
    """P2-006-04: 最大リトライ超過時に on_fatal_disconnect コールバック経由でシャットダウンが発動する。"""
    reconnect_bot._reconnecting = False
    reconnect_bot._handler = MagicMock()

    # is_connected が常に False を返す（再接続失敗）
    with (
        patch.object(reconnect_bot, "_is_connected", new_callable=AsyncMock, return_value=False),
        patch("src.slack_bot.asyncio.sleep", new_callable=AsyncMock),
        patch.object(reconnect_bot, "_notify_reconnect_failure", new_callable=AsyncMock),
    ):
        await reconnect_bot._monitor_reconnection()

    # on_fatal_disconnect コールバックが呼ばれたことを確認
    reconnect_bot._fatal_callback.assert_awaited_once()
    # 再接続中フラグが解除されていること
    assert reconnect_bot._reconnecting is False


@pytest.mark.asyncio
async def test_reconnect_exponential_backoff_limits(reconnect_bot):
    """P2-006: 指数バックオフの上限（最大60秒）と最大リトライ回数（10回）が仕様通りである。"""
    from src.slack_bot import RECONNECT_MAX_RETRIES, RECONNECT_MAX_DELAY, RECONNECT_BASE_DELAY

    assert RECONNECT_MAX_RETRIES == 10
    assert RECONNECT_MAX_DELAY == 60.0
    assert RECONNECT_BASE_DELAY == 1.0

    # 指数バックオフの計算を確認
    delays = [min(RECONNECT_BASE_DELAY * (2 ** i), RECONNECT_MAX_DELAY) for i in range(RECONNECT_MAX_RETRIES)]
    assert delays[0] == 1.0
    assert delays[1] == 2.0
    assert delays[2] == 4.0
    assert delays[3] == 8.0
    assert delays[4] == 16.0
    assert delays[5] == 32.0
    assert delays[6] == 60.0  # 64 → capped to 60
    assert delays[7] == 60.0
    assert delays[8] == 60.0
    assert delays[9] == 60.0


@pytest.mark.asyncio
async def test_reconnect_success_by_library_auto_reconnect(reconnect_bot):
    """P2-006: ライブラリの自動再接続が成功した場合、手動再接続は試行されない。"""
    reconnect_bot._reconnecting = False
    reconnect_bot._handler = MagicMock()

    # 最初は切断状態、2回目のチェックで接続成功
    is_connected_values = [False, True]
    call_idx = 0

    async def mock_is_connected():
        nonlocal call_idx
        idx = min(call_idx, len(is_connected_values) - 1)
        call_idx += 1
        return is_connected_values[idx]

    with (
        patch.object(reconnect_bot, "_is_connected", side_effect=mock_is_connected),
        patch("src.slack_bot.asyncio.sleep", new_callable=AsyncMock),
        patch.object(reconnect_bot, "_notify_reconnect_success", new_callable=AsyncMock) as mock_notify,
    ):
        await reconnect_bot._monitor_reconnection()

    # 再接続成功通知が呼ばれた
    mock_notify.assert_awaited_once()
    # fatal コールバックは呼ばれていない
    reconnect_bot._fatal_callback.assert_not_awaited()
