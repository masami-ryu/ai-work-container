"""SQLite 監査ログ"""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

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
    slack_message_ts TEXT
)
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
    ) -> None:
        conn = self._get_conn()
        conn.execute(
            """\
            INSERT INTO audit_log
                (correlation_id, timestamp, request_type, tool_name, summary,
                 decision, responder_user_id, response_time_sec, slack_message_ts)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            ),
        )
        conn.commit()
