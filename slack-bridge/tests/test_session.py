"""SessionManager のユニットテスト"""

from __future__ import annotations

import asyncio
from collections import deque
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.session import SessionManager, Session, ToolStats, OUTPUT_BUFFER_MAX_LINES
from src.bridge import RequestBridge
from src.audit import AuditLog
from src.config import Config


def _make_config(**overrides) -> Config:
    defaults = dict(
        slack_app_token="xapp-1-A0001-000-abc123",
        slack_bot_token="xoxb-111-222-abc123",
        slack_channel="test-channel",
        slack_approver_user_id="UAPPROVER01",
    )
    defaults.update(overrides)
    return Config(**defaults)


def _make_bot():
    bot = MagicMock()
    bot.post_message = AsyncMock(return_value={"ts": "1234.5678"})
    bot.update_message = AsyncMock()
    return bot


# TEST-002: SessionManager.start_session でセッション開始
@pytest.mark.asyncio
async def test_start_session():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    bot = _make_bot()

    sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

    with patch("src.session.ClaudeSDKClient") as mock_sdk:
        mock_client_instance = AsyncMock()
        mock_sdk.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_sdk.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client_instance.receive_response = AsyncMock(return_value=AsyncMock(
            __aiter__=lambda self: self,
            __anext__=AsyncMock(side_effect=StopAsyncIteration),
        ))

        session = await sm.start_session("test prompt", "/tmp/project")

    assert session.session_id is not None
    assert session.prompt == "test prompt"
    assert session.cwd == "/tmp/project"
    assert session.thread_ts == "1234.5678"
    assert session.task is not None

    # Slack にセッション開始メッセージが投稿された
    bot.post_message.assert_called()

    # クリーンアップ
    await sm.shutdown()


# TEST-003: SessionManager.list_sessions でアクティブ一覧
@pytest.mark.asyncio
async def test_list_sessions():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    bot = _make_bot()

    sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

    with patch("src.session.ClaudeSDKClient"):
        session = await sm.start_session("test prompt", "/tmp/project")

    sessions = sm.list_sessions()
    assert len(sessions) == 1
    assert sessions[0]["session_id"] == session.session_id
    assert sessions[0]["prompt"] == "test prompt"
    assert sessions[0]["status"] == "running"

    await sm.shutdown()


# TEST-010: 出力バッファが 1000 行を超えた場合の切り捨て
def test_output_buffer_overflow():
    session = Session(
        session_id="test",
        prompt="test",
        cwd=".",
    )
    # 1500 行追加
    for i in range(1500):
        session.output_buffer.append(f"line {i}\n")

    assert len(session.output_buffer) == OUTPUT_BUFFER_MAX_LINES
    # 先頭 500 行は切り捨てられている
    assert session.output_buffer[0] == "line 500\n"
    assert session.output_buffer[-1] == "line 1499\n"


# TEST-011: get_output_tail で指定行数を取得
@pytest.mark.asyncio
async def test_get_output_tail():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    bot = _make_bot()

    sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

    with patch("src.session.ClaudeSDKClient"):
        session = await sm.start_session("test", ".")

    # 500 行追加
    for i in range(500):
        session.output_buffer.append(f"line {i}\n")

    # tail=50 で最新 50 行を取得
    lines = sm.get_output_tail(session.session_id, tail=50)
    assert len(lines) == 50
    assert lines[0] == "line 450\n"
    assert lines[-1] == "line 499\n"

    # tail=0 で空リスト
    lines = sm.get_output_tail(session.session_id, tail=0)
    assert lines == []

    await sm.shutdown()


# TEST: subscribe_events でイベントを受信
@pytest.mark.asyncio
async def test_subscribe_events():
    bridge = RequestBridge()
    audit = AuditLog(":memory:")
    config = _make_config()
    bot = _make_bot()

    sm = SessionManager(bot=bot, bridge=bridge, config=config, audit=audit)

    with patch("src.session.ClaudeSDKClient"):
        session = await sm.start_session("test", ".")

    received = []

    async def collect_events():
        async for event in sm.subscribe_events(session.session_id):
            received.append(event)
            if event["type"] in ("completed", "error"):
                break

    task = asyncio.create_task(collect_events())

    # イベントを手動で発火
    await asyncio.sleep(0.05)
    sm._emit_output(session, "hello\n")
    sm._emit_event(session, {"type": "completed", "session_id": session.session_id})

    await asyncio.wait_for(task, timeout=2.0)

    assert len(received) == 2
    assert received[0]["type"] == "output"
    assert received[0]["text"] == "hello\n"
    assert received[1]["type"] == "completed"

    await sm.shutdown()


# --- TASK-505: ToolStats.record_use のテスト ---


class TestToolStatsRecordUse:
    """ToolStats.record_use の各 decision に対する動作テスト。"""

    def test_record_auto_allow(self):
        """auto_allow decision で auto_allowed カウンタが増加する。"""
        stats = ToolStats()
        stats.record_use("Read", "auto_allow")

        assert stats.total_uses == 1
        assert stats.auto_allowed == 1
        assert stats.allowed == 0
        assert stats.denied == 0
        assert stats.timeouts == 0
        assert stats.last_tool == "Read"
        assert stats.tool_counts == {"Read": 1}

    def test_record_allow(self):
        """allow decision で allowed カウンタが増加する。"""
        stats = ToolStats()
        stats.record_use("Bash", "allow")

        assert stats.total_uses == 1
        assert stats.allowed == 1
        assert stats.auto_allowed == 0
        assert stats.denied == 0

    def test_record_deny(self):
        """deny decision で denied カウンタが増加する。"""
        stats = ToolStats()
        stats.record_use("Bash", "deny")

        assert stats.total_uses == 1
        assert stats.denied == 1
        assert stats.allowed == 0

    def test_record_timeout(self):
        """timeout decision で timeouts と consecutive_timeouts が増加する。"""
        stats = ToolStats()
        stats.record_use("Bash", "timeout")

        assert stats.total_uses == 1
        assert stats.timeouts == 1
        assert stats.consecutive_timeouts == 1

    def test_record_unknown_decision_counts_as_deny(self):
        """不明な decision は denied としてカウントされる。"""
        stats = ToolStats()
        stats.record_use("Bash", "unknown_decision")

        assert stats.total_uses == 1
        assert stats.denied == 1

    def test_multiple_tools_tracked(self):
        """複数ツールの使用が正しくカウントされる。"""
        stats = ToolStats()
        stats.record_use("Read", "auto_allow")
        stats.record_use("Read", "auto_allow")
        stats.record_use("Bash", "allow")
        stats.record_use("Write", "deny")

        assert stats.total_uses == 4
        assert stats.auto_allowed == 2
        assert stats.allowed == 1
        assert stats.denied == 1
        assert stats.tool_counts == {"Read": 2, "Bash": 1, "Write": 1}
        assert stats.last_tool == "Write"


# --- TASK-505: ToolStats.record_use の changed_files 追跡テスト ---


class TestToolStatsChangedFiles:
    """Write/Edit ツールの allow 時に changed_files が追跡される。"""

    def test_write_allow_tracks_file(self):
        """Write ツールで allow された場合、file_path が changed_files に追加される。"""
        stats = ToolStats()
        stats.record_use("Write", "allow", file_path="/tmp/test.py")

        assert stats.changed_files == ["/tmp/test.py"]

    def test_edit_allow_tracks_file(self):
        """Edit ツールで allow された場合、file_path が changed_files に追加される。"""
        stats = ToolStats()
        stats.record_use("Edit", "allow", file_path="/tmp/edit.py")

        assert stats.changed_files == ["/tmp/edit.py"]

    def test_notebook_edit_allow_tracks_file(self):
        """NotebookEdit ツールで allow された場合、file_path が changed_files に追加される。"""
        stats = ToolStats()
        stats.record_use("NotebookEdit", "allow", file_path="/tmp/notebook.ipynb")

        assert stats.changed_files == ["/tmp/notebook.ipynb"]

    def test_write_deny_does_not_track_file(self):
        """Write ツールで deny された場合、file_path は changed_files に追加されない。"""
        stats = ToolStats()
        stats.record_use("Write", "deny", file_path="/tmp/denied.py")

        assert stats.changed_files == []

    def test_bash_allow_does_not_track_file(self):
        """Bash ツールで allow されても file_path は changed_files に追加されない。"""
        stats = ToolStats()
        stats.record_use("Bash", "allow", file_path="/tmp/bash_output.txt")

        assert stats.changed_files == []

    def test_no_duplicate_files(self):
        """同じファイルが複数回 allow されても changed_files に重複追加されない。"""
        stats = ToolStats()
        stats.record_use("Write", "allow", file_path="/tmp/test.py")
        stats.record_use("Edit", "allow", file_path="/tmp/test.py")

        assert stats.changed_files == ["/tmp/test.py"]

    def test_none_file_path_not_tracked(self):
        """file_path が None の場合は changed_files に追加されない。"""
        stats = ToolStats()
        stats.record_use("Write", "allow", file_path=None)

        assert stats.changed_files == []


# --- TASK-505: ToolStats.consecutive_timeouts のリセットテスト ---


class TestToolStatsConsecutiveTimeouts:
    """consecutive_timeouts カウンタのインクリメントとリセットの動作テスト。"""

    def test_consecutive_timeouts_increment(self):
        """連続 timeout で consecutive_timeouts がインクリメントされる。"""
        stats = ToolStats()
        stats.record_use("Bash", "timeout")
        assert stats.consecutive_timeouts == 1

        stats.record_use("Bash", "timeout")
        assert stats.consecutive_timeouts == 2

        stats.record_use("Bash", "timeout")
        assert stats.consecutive_timeouts == 3

    def test_consecutive_timeouts_reset_on_allow(self):
        """allow 応答で consecutive_timeouts がリセットされる。"""
        stats = ToolStats()
        stats.record_use("Bash", "timeout")
        stats.record_use("Bash", "timeout")
        assert stats.consecutive_timeouts == 2

        stats.record_use("Bash", "allow")
        assert stats.consecutive_timeouts == 0
        # total timeouts は維持される
        assert stats.timeouts == 2

    def test_consecutive_timeouts_reset_on_deny(self):
        """deny 応答で consecutive_timeouts がリセットされる。"""
        stats = ToolStats()
        stats.record_use("Bash", "timeout")
        stats.record_use("Bash", "timeout")
        stats.record_use("Bash", "deny")

        assert stats.consecutive_timeouts == 0
        assert stats.timeouts == 2

    def test_consecutive_timeouts_reset_on_auto_allow(self):
        """auto_allow 応答で consecutive_timeouts がリセットされる。"""
        stats = ToolStats()
        stats.record_use("Bash", "timeout")
        stats.record_use("Read", "auto_allow")

        assert stats.consecutive_timeouts == 0
        assert stats.timeouts == 1

    def test_interleaved_timeout_and_allow(self):
        """timeout と allow が交互に来た場合、consecutive_timeouts は 1 を超えない。"""
        stats = ToolStats()
        stats.record_use("Bash", "timeout")
        assert stats.consecutive_timeouts == 1

        stats.record_use("Bash", "allow")
        assert stats.consecutive_timeouts == 0

        stats.record_use("Bash", "timeout")
        assert stats.consecutive_timeouts == 1

        stats.record_use("Bash", "allow")
        assert stats.consecutive_timeouts == 0

        assert stats.timeouts == 2


# --- TASK-505: ToolStats.to_dict() テスト ---


class TestToolStatsToDict:
    """ToolStats.to_dict() の出力形式テスト。"""

    def test_empty_stats(self):
        """初期状態の ToolStats.to_dict() の出力。"""
        stats = ToolStats()
        result = stats.to_dict()

        assert result == {
            "total_uses": 0,
            "allowed": 0,
            "denied": 0,
            "auto_allowed": 0,
            "timeouts": 0,
        }

    def test_populated_stats(self):
        """各種操作後の ToolStats.to_dict() の出力。"""
        stats = ToolStats()
        stats.record_use("Read", "auto_allow")
        stats.record_use("Read", "auto_allow")
        stats.record_use("Bash", "allow")
        stats.record_use("Write", "deny")
        stats.record_use("Bash", "timeout")

        result = stats.to_dict()

        assert result == {
            "total_uses": 5,
            "allowed": 1,
            "denied": 1,
            "auto_allowed": 2,
            "timeouts": 1,
        }

    def test_to_dict_does_not_include_internal_fields(self):
        """to_dict() は内部フィールド (changed_files, tool_counts 等) を含まない。"""
        stats = ToolStats()
        stats.record_use("Write", "allow", file_path="/tmp/test.py")

        result = stats.to_dict()

        assert "changed_files" not in result
        assert "tool_counts" not in result
        assert "consecutive_timeouts" not in result
        assert "last_tool" not in result


# --- TASK-505: session_end_blocks のリッチサマリテスト ---


class TestSessionEndBlocks:
    """session_end_blocks のリッチサマリ（duration, tool_stats, changed_files, error_message）テスト。"""

    def test_completed_with_duration(self):
        """completed ステータスで duration が表示される。"""
        from src.slack_messages import session_end_blocks

        blocks = session_end_blocks("sess-001", "completed", duration_sec=125.0)

        # ヘッダ部分
        assert "completed" in blocks[0]["text"]["text"]
        assert "sess-001" in blocks[0]["text"]["text"]
        # duration フィールド
        fields_text = str(blocks[1]["fields"])
        assert "2m 5s" in fields_text

    def test_completed_with_duration_seconds_only(self):
        """60 秒未満の duration は秒のみで表示される。"""
        from src.slack_messages import session_end_blocks

        blocks = session_end_blocks("sess-002", "completed", duration_sec=45.0)

        fields_text = str(blocks[1]["fields"])
        assert "45s" in fields_text

    def test_completed_with_tool_stats(self):
        """tool_stats が含まれる場合、ツール統計が表示される。"""
        from src.slack_messages import session_end_blocks

        tool_stats = {
            "total_uses": 10,
            "allowed": 3,
            "denied": 1,
            "auto_allowed": 5,
            "timeouts": 1,
        }
        blocks = session_end_blocks("sess-003", "completed", tool_stats=tool_stats)

        fields_text = str(blocks)
        assert "Total: 10" in fields_text

    def test_completed_with_changed_files(self):
        """changed_files が含まれる場合、変更ファイル一覧が表示される。"""
        from src.slack_messages import session_end_blocks

        blocks = session_end_blocks(
            "sess-004",
            "completed",
            changed_files=["/tmp/a.py", "/tmp/b.py"],
        )

        blocks_text = str(blocks)
        assert "/tmp/a.py" in blocks_text
        assert "/tmp/b.py" in blocks_text
        assert "Changed files" in blocks_text

    def test_error_with_error_message(self):
        """error ステータスで error_message が表示される。"""
        from src.slack_messages import session_end_blocks

        blocks = session_end_blocks(
            "sess-005",
            "error",
            error_message="Connection timeout",
        )

        blocks_text = str(blocks)
        assert "error" in blocks_text.lower()
        assert "Connection timeout" in blocks_text

    def test_full_rich_summary(self):
        """全てのリッチサマリ情報が含まれるケース。"""
        from src.slack_messages import session_end_blocks

        blocks = session_end_blocks(
            "sess-006",
            "completed",
            duration_sec=305.5,
            tool_stats={
                "total_uses": 25,
                "allowed": 8,
                "denied": 2,
                "auto_allowed": 14,
                "timeouts": 1,
            },
            changed_files=["/src/main.py", "/tests/test_main.py"],
            error_message=None,
        )

        blocks_text = str(blocks)
        assert "sess-006" in blocks_text
        assert "completed" in blocks_text
        assert "5m 5s" in blocks_text
        assert "Total: 25" in blocks_text
        assert "/src/main.py" in blocks_text
        assert "/tests/test_main.py" in blocks_text

    def test_error_with_all_fields(self):
        """error ステータスで全フィールドが表示される。"""
        from src.slack_messages import session_end_blocks

        blocks = session_end_blocks(
            "sess-007",
            "error",
            duration_sec=60.0,
            tool_stats={
                "total_uses": 5,
                "allowed": 2,
                "denied": 0,
                "auto_allowed": 3,
                "timeouts": 0,
            },
            changed_files=["/tmp/partial.py"],
            error_message="SDK connection lost",
        )

        blocks_text = str(blocks)
        assert "sess-007" in blocks_text
        assert "1m 0s" in blocks_text
        assert "Total: 5" in blocks_text
        assert "/tmp/partial.py" in blocks_text
        assert "SDK connection lost" in blocks_text

    def test_cancelled_status(self):
        """cancelled ステータスのブロック生成。"""
        from src.slack_messages import session_end_blocks

        blocks = session_end_blocks("sess-008", "cancelled")

        blocks_text = str(blocks)
        assert "sess-008" in blocks_text
        assert "cancelled" in blocks_text

    def test_no_optional_fields(self):
        """オプショナルフィールドが全て未指定の場合。"""
        from src.slack_messages import session_end_blocks

        blocks = session_end_blocks("sess-009", "completed")

        # 最低限ヘッダブロックだけが存在する
        assert len(blocks) >= 1
        assert "sess-009" in blocks[0]["text"]["text"]
