"""P5-001: セッション状態の SQLite 永続化層。

audit.py のパターン（テーブル定義・接続管理）を参照し整合性を確保。
WAL モードを有効化して同時アクセスの競合を軽減。
"""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_CREATE_TABLE = """\
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    cwd TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    thread_ts TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""

# 有効なセッションステータス
VALID_STATUSES = frozenset({"running", "completed", "error", "cancelled", "interrupted"})

# 終端ステータス（P5-004: クリーンアップ対象）
TERMINAL_STATUSES = frozenset({"completed", "error", "cancelled", "interrupted"})


class SessionStore:
    """セッション状態の SQLite 永続化を管理する。

    session.db に sessions テーブルを保持し、セッションのライフサイクルを記録する。
    WAL モードを有効化して並行読み取りの性能を向上。
    """

    def __init__(self, db_path: str | Path = "session.db") -> None:
        self._db_path = str(db_path)
        self._local = threading.local()
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self._db_path)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.row_factory = sqlite3.Row
            self._local.conn = conn
        return conn

    def _init_db(self) -> None:
        conn = self._get_conn()
        conn.execute(_CREATE_TABLE)
        conn.commit()

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def save(
        self,
        *,
        session_id: str,
        prompt: str,
        cwd: str,
        status: str = "running",
        thread_ts: str | None = None,
        started_at: str | None = None,
    ) -> None:
        """セッション状態を保存（INSERT or UPDATE）。"""
        if status not in VALID_STATUSES:
            raise ValueError(f"Invalid status: {status}. Valid: {VALID_STATUSES}")

        conn = self._get_conn()
        now = self._now_iso()
        conn.execute(
            """\
            INSERT INTO sessions (session_id, prompt, cwd, status, thread_ts, started_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id)
            DO UPDATE SET status=excluded.status, thread_ts=excluded.thread_ts, updated_at=excluded.updated_at
            """,
            (session_id, prompt, cwd, status, thread_ts, started_at or now, now),
        )
        conn.commit()

    def update_status(self, session_id: str, status: str) -> None:
        """セッションのステータスを更新する。"""
        if status not in VALID_STATUSES:
            raise ValueError(f"Invalid status: {status}. Valid: {VALID_STATUSES}")

        conn = self._get_conn()
        conn.execute(
            "UPDATE sessions SET status = ?, updated_at = ? WHERE session_id = ?",
            (status, self._now_iso(), session_id),
        )
        conn.commit()

    def load(self, session_id: str) -> dict[str, Any] | None:
        """セッション状態を読み込む。見つからない場合は None を返す。"""
        conn = self._get_conn()
        cursor = conn.execute(
            "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return dict(row)

    def delete(self, session_id: str) -> None:
        """セッションレコードを削除する。"""
        conn = self._get_conn()
        conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
        conn.commit()

    def list_all(self) -> list[dict[str, Any]]:
        """全セッションを返す（新しい順）。"""
        conn = self._get_conn()
        cursor = conn.execute(
            "SELECT * FROM sessions ORDER BY started_at DESC"
        )
        return [dict(row) for row in cursor.fetchall()]

    def list_by_status(self, status: str) -> list[dict[str, Any]]:
        """指定ステータスのセッションを返す。"""
        conn = self._get_conn()
        cursor = conn.execute(
            "SELECT * FROM sessions WHERE status = ? ORDER BY started_at DESC",
            (status,),
        )
        return [dict(row) for row in cursor.fetchall()]

    def list_active(self) -> list[dict[str, Any]]:
        """running ステータスのセッションを返す。"""
        return self.list_by_status("running")
