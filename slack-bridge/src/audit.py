"""SQLite 監査ログ"""

from __future__ import annotations

import asyncio
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_CREATE_TABLE = """\
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    correlation_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    request_type TEXT NOT NULL,
    tool_name TEXT,
    summary TEXT,
    decision TEXT NOT NULL,
    responder_user_id TEXT,
    response_time_sec REAL,
    slack_message_ts TEXT,
    session_id TEXT
)
"""

# TASK-601: session_id カラムのマイグレーション
_MIGRATE_SESSION_ID = """\
ALTER TABLE audit_log ADD COLUMN session_id TEXT
"""


class AuditLog:
    def __init__(self, db_path: str | Path = "audit.db") -> None:
        self._db_path = str(db_path)
        self._local = threading.local()
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self._db_path)
            self._local.conn = conn
        return conn

    def _init_db(self) -> None:
        conn = self._get_conn()
        conn.execute(_CREATE_TABLE)
        conn.commit()
        # session_id カラムのマイグレーション（既存DBにカラムがない場合）
        try:
            conn.execute(_MIGRATE_SESSION_ID)
            conn.commit()
        except sqlite3.OperationalError:
            # カラムが既に存在する場合は無視
            pass

    def record(
        self,
        *,
        correlation_id: str,
        request_type: str,
        tool_name: str | None = None,
        summary: str | None = None,
        decision: str,
        responder_user_id: str | None = None,
        response_time_sec: float | None = None,
        slack_message_ts: str | None = None,
        session_id: str | None = None,
    ) -> None:
        conn = self._get_conn()
        conn.execute(
            """\
            INSERT INTO audit_log
                (correlation_id, timestamp, request_type, tool_name, summary,
                 decision, responder_user_id, response_time_sec, slack_message_ts,
                 session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                correlation_id,
                datetime.now(timezone.utc).isoformat(),
                request_type,
                tool_name,
                summary,
                decision,
                responder_user_id,
                response_time_sec,
                slack_message_ts,
                session_id,
            ),
        )
        conn.commit()

    async def arecord(self, **kwargs: Any) -> None:
        """TASK-601: 非同期版の record。asyncio.to_thread でラップ。"""
        await asyncio.to_thread(self.record, **kwargs)

    def query(
        self,
        *,
        session_id: str | None = None,
        tool_name: str | None = None,
        decision: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """TASK-601: 監査ログのクエリ機能。"""
        conn = self._get_conn()
        conditions: list[str] = []
        params: list[Any] = []

        if session_id is not None:
            conditions.append("session_id = ?")
            params.append(session_id)
        if tool_name is not None:
            conditions.append("tool_name = ?")
            params.append(tool_name)
        if decision is not None:
            conditions.append("decision = ?")
            params.append(decision)

        where = " AND ".join(conditions) if conditions else "1=1"
        cursor = conn.execute(
            f"SELECT * FROM audit_log WHERE {where} ORDER BY id DESC LIMIT ?",
            params + [limit],
        )
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
