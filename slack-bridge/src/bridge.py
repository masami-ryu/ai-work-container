"""非同期ブリッジ: Slack ↔ Agent SDK の同期プリミティブ"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Literal


@dataclass
class PendingRequest:
    correlation_id: str
    request_type: Literal["permission", "ask_question"]
    event: asyncio.Event
    result: dict | None = None
    message_ts: str | None = None
    created_at: float = field(default_factory=time.time)
    partial_selections: dict[str, list[str]] | None = None  # multiSelect 用


class RequestBridge:
    """pending_requests の管理、correlation_id 生成、タイムアウト処理"""

    def __init__(self) -> None:
        self._pending: dict[str, PendingRequest] = {}

    def create_request(
        self, request_type: Literal["permission", "ask_question"]
    ) -> PendingRequest:
        cid = uuid.uuid4().hex[:12]
        req = PendingRequest(
            correlation_id=cid,
            request_type=request_type,
            event=asyncio.Event(),
        )
        self._pending[cid] = req
        return req

    def has_pending(self, correlation_id: str) -> bool:
        return correlation_id in self._pending

    def get_request(self, correlation_id: str) -> PendingRequest | None:
        """P4-004: correlation_id から PendingRequest を取得する（Details ボタン用）。"""
        return self._pending.get(correlation_id)

    def resolve(self, correlation_id: str, result: dict) -> None:
        req = self._pending.pop(correlation_id, None)
        if req is None:
            return
        req.result = result
        req.event.set()

    async def wait_for_response(
        self, correlation_id: str, timeout: float
    ) -> dict:
        req = self._pending.get(correlation_id)
        if req is None:
            return {"decision": "deny", "reason": "not_found"}
        try:
            await asyncio.wait_for(req.event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(correlation_id, None)
            return {"decision": "deny", "reason": "timeout"}
        return req.result or {"decision": "deny", "reason": "empty"}

    # --- multiSelect トグル/確定 ---

    def toggle_selection(
        self, correlation_id: str, question: str, label: str
    ) -> list[str]:
        req = self._pending.get(correlation_id)
        if req is None:
            return []
        if req.partial_selections is None:
            req.partial_selections = {}
        selections = req.partial_selections.setdefault(question, [])
        if label in selections:
            selections.remove(label)
        else:
            selections.append(label)
        return list(selections)

    def confirm_selections(self, correlation_id: str) -> None:
        req = self._pending.get(correlation_id)
        if req is None:
            return
        answers: dict[str, str] = {}
        for question, labels in (req.partial_selections or {}).items():
            answers[question] = ", ".join(labels)
        self.resolve(correlation_id, {"decision": "answered", "answers": answers})

    # --- シャットダウン ---

    async def shutdown(self) -> None:
        for req in list(self._pending.values()):
            req.result = {"decision": "deny", "reason": "shutdown"}
            req.event.set()
        self._pending.clear()
