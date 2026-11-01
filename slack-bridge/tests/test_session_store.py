"""P5-006: SessionStore ユニットテスト。

save/load/delete/list の基本操作、ステータスバリデーション、
WAL モード有効化、復旧シナリオをテストする。
"""

from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

import pytest

from src.session_store import SessionStore, VALID_STATUSES, TERMINAL_STATUSES


@pytest.fixture
def tmp_db(tmp_path: Path) -> Path:
    """テスト用の一時 DB パスを返す。"""
    return tmp_path / "test_session.db"


@pytest.fixture
def store(tmp_db: Path) -> SessionStore:
    """テスト用の SessionStore を返す。"""
    return SessionStore(db_path=tmp_db)


class TestSessionStoreBasicCRUD:
    """基本的な CRUD 操作のテスト。"""

    def test_save_and_load(self, store: SessionStore) -> None:
        """save したセッションを load で取得できる。"""
        store.save(
            session_id="abc12345",
            prompt="Hello world",
            cwd="/tmp/test",
            status="running",
            thread_ts="1234567890.123456",
        )
        row = store.load("abc12345")
        assert row is not None
        assert row["session_id"] == "abc12345"
        assert row["prompt"] == "Hello world"
        assert row["cwd"] == "/tmp/test"
        assert row["status"] == "running"
        assert row["thread_ts"] == "1234567890.123456"
        assert row["started_at"] is not None
        assert row["updated_at"] is not None

    def test_load_nonexistent(self, store: SessionStore) -> None:
        """存在しないセッションを load すると None が返る。"""
        assert store.load("nonexistent") is None

    def test_save_upsert(self, store: SessionStore) -> None:
        """同一 session_id で save すると status と thread_ts が更新される。"""
        store.save(
            session_id="abc12345",
            prompt="Hello world",
            cwd="/tmp/test",
            status="running",
        )
        store.save(
            session_id="abc12345",
            prompt="Hello world",
            cwd="/tmp/test",
            status="completed",
            thread_ts="new_thread_ts",
        )
        row = store.load("abc12345")
        assert row is not None
        assert row["status"] == "completed"
        assert row["thread_ts"] == "new_thread_ts"

    def test_update_status(self, store: SessionStore) -> None:
        """update_status でステータスのみ更新される。"""
        store.save(
            session_id="abc12345",
            prompt="Test",
            cwd=".",
            status="running",
        )
        store.update_status("abc12345", "completed")
        row = store.load("abc12345")
        assert row is not None
        assert row["status"] == "completed"

    def test_delete(self, store: SessionStore) -> None:
        """delete でレコードが削除される。"""
        store.save(
            session_id="abc12345",
            prompt="Test",
            cwd=".",
            status="running",
        )
        store.delete("abc12345")
        assert store.load("abc12345") is None

    def test_delete_nonexistent(self, store: SessionStore) -> None:
        """存在しないセッションの delete はエラーにならない。"""
        store.delete("nonexistent")  # should not raise


class TestSessionStoreList:
    """一覧取得のテスト。"""

    def test_list_all_empty(self, store: SessionStore) -> None:
        """空の DB で list_all は空リストを返す。"""
        assert store.list_all() == []

    def test_list_all_multiple(self, store: SessionStore) -> None:
        """複数セッションが started_at 降順で返される。"""
        store.save(
            session_id="first",
            prompt="First",
            cwd=".",
            status="completed",
            started_at="2026-01-01T00:00:00+00:00",
        )
        store.save(
            session_id="second",
            prompt="Second",
            cwd=".",
            status="running",
            started_at="2026-01-02T00:00:00+00:00",
        )
        results = store.list_all()
        assert len(results) == 2
        assert results[0]["session_id"] == "second"  # newer first
        assert results[1]["session_id"] == "first"

    def test_list_by_status(self, store: SessionStore) -> None:
        """list_by_status で指定ステータスのセッションのみ返される。"""
        store.save(session_id="s1", prompt="P1", cwd=".", status="running")
        store.save(session_id="s2", prompt="P2", cwd=".", status="completed")
        store.save(session_id="s3", prompt="P3", cwd=".", status="running")

        running = store.list_by_status("running")
        assert len(running) == 2
        assert all(r["status"] == "running" for r in running)

        completed = store.list_by_status("completed")
        assert len(completed) == 1
        assert completed[0]["session_id"] == "s2"

    def test_list_active(self, store: SessionStore) -> None:
        """list_active は running ステータスのみ返す。"""
        store.save(session_id="s1", prompt="P1", cwd=".", status="running")
        store.save(session_id="s2", prompt="P2", cwd=".", status="error")
        store.save(session_id="s3", prompt="P3", cwd=".", status="running")

        active = store.list_active()
        assert len(active) == 2
        assert all(r["status"] == "running" for r in active)


class TestSessionStoreValidation:
    """ステータスバリデーションのテスト。"""

    def test_save_invalid_status(self, store: SessionStore) -> None:
        """save に無効なステータスを渡すと ValueError。"""
        with pytest.raises(ValueError, match="Invalid status"):
            store.save(
                session_id="abc12345",
                prompt="Test",
                cwd=".",
                status="invalid_status",
            )

    def test_update_status_invalid(self, store: SessionStore) -> None:
        """update_status に無効なステータスを渡すと ValueError。"""
        store.save(session_id="abc12345", prompt="Test", cwd=".", status="running")
        with pytest.raises(ValueError, match="Invalid status"):
            store.update_status("abc12345", "bad_status")

    def test_all_valid_statuses(self, store: SessionStore) -> None:
        """全ての有効なステータスで save できる。"""
        for i, status in enumerate(VALID_STATUSES):
            store.save(
                session_id=f"s{i}",
                prompt="Test",
                cwd=".",
                status=status,
            )
            row = store.load(f"s{i}")
            assert row is not None
            assert row["status"] == status


class TestSessionStoreWALMode:
    """WAL モード有効化のテスト。"""

    def test_wal_mode_enabled(self, tmp_db: Path) -> None:
        """SessionStore 初期化後に WAL モードが有効化されている。"""
        store = SessionStore(db_path=tmp_db)
        conn = sqlite3.connect(str(tmp_db))
        cursor = conn.execute("PRAGMA journal_mode")
        mode = cursor.fetchone()[0]
        conn.close()
        assert mode == "wal"


class TestSessionStoreRecovery:
    """P5-003 の復旧シナリオに関連するテスト。"""

    def test_active_sessions_after_crash(self, store: SessionStore) -> None:
        """クラッシュ後に status=running のセッションが list_active で取得できる。"""
        store.save(session_id="crashed1", prompt="P1", cwd=".", status="running",
                   thread_ts="thread1")
        store.save(session_id="crashed2", prompt="P2", cwd=".", status="running",
                   thread_ts="thread2")
        store.save(session_id="done", prompt="P3", cwd=".", status="completed")

        active = store.list_active()
        assert len(active) == 2
        active_ids = {s["session_id"] for s in active}
        assert active_ids == {"crashed1", "crashed2"}

    def test_update_to_interrupted(self, store: SessionStore) -> None:
        """running → interrupted へのステータス更新（復旧処理）。"""
        store.save(session_id="crashed", prompt="P", cwd=".", status="running")
        store.update_status("crashed", "interrupted")
        row = store.load("crashed")
        assert row is not None
        assert row["status"] == "interrupted"

    def test_no_duplicate_recovery(self, store: SessionStore) -> None:
        """interrupted に更新済みのセッションは list_active に出てこない（重複防止）。"""
        store.save(session_id="s1", prompt="P", cwd=".", status="running")
        store.update_status("s1", "interrupted")

        active = store.list_active()
        assert len(active) == 0

    def test_started_at_preserved_on_upsert(self, store: SessionStore) -> None:
        """upsert 時に started_at は初回の値が保持される。"""
        store.save(
            session_id="abc",
            prompt="Hello",
            cwd=".",
            status="running",
            started_at="2026-01-01T00:00:00+00:00",
        )
        # upsert（status 更新）
        store.save(
            session_id="abc",
            prompt="Hello",
            cwd=".",
            status="completed",
        )
        row = store.load("abc")
        assert row is not None
        # started_at は初回保存時の値が保持される（ON CONFLICT では更新しない）
        assert row["started_at"] == "2026-01-01T00:00:00+00:00"


class TestSessionStoreConstants:
    """定数定義のテスト。"""

    def test_valid_statuses_includes_all(self) -> None:
        """VALID_STATUSES に全ステータスが含まれている。"""
        expected = {"running", "completed", "error", "cancelled", "interrupted"}
        assert VALID_STATUSES == expected

    def test_terminal_statuses_subset(self) -> None:
        """TERMINAL_STATUSES は VALID_STATUSES のサブセット。"""
        assert TERMINAL_STATUSES.issubset(VALID_STATUSES)

    def test_running_not_terminal(self) -> None:
        """running は TERMINAL_STATUSES に含まれない。"""
        assert "running" not in TERMINAL_STATUSES

    def test_terminal_statuses_content(self) -> None:
        """TERMINAL_STATUSES の内容が正しい。"""
        expected = {"completed", "error", "cancelled", "interrupted"}
        assert TERMINAL_STATUSES == expected
