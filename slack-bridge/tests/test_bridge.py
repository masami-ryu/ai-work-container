"""RequestBridge のユニットテスト (TEST-001, 002, 011, 012)"""

from __future__ import annotations

import asyncio

import pytest

from src.bridge import RequestBridge


# TEST-001: wait → resolve で結果が返る
@pytest.mark.asyncio
async def test_wait_resolve():
    bridge = RequestBridge()
    req = bridge.create_request("permission")
    cid = req.correlation_id

    async def resolve_later():
        await asyncio.sleep(0.05)
        bridge.resolve(cid, {"decision": "allow"})

    asyncio.create_task(resolve_later())
    result = await bridge.wait_for_response(cid, timeout=2.0)
    assert result["decision"] == "allow"


# TEST-002: タイムアウト時に deny が返る
@pytest.mark.asyncio
async def test_timeout_deny():
    bridge = RequestBridge()
    req = bridge.create_request("permission")
    cid = req.correlation_id

    result = await bridge.wait_for_response(cid, timeout=0.1)
    assert result["decision"] == "deny"
    assert result["reason"] == "timeout"


# TEST-011: shutdown() で全 pending が deny 解決される
@pytest.mark.asyncio
async def test_shutdown_resolves_all():
    bridge = RequestBridge()
    req1 = bridge.create_request("permission")
    req2 = bridge.create_request("ask_question")

    await bridge.shutdown()

    assert req1.result == {"decision": "deny", "reason": "shutdown"}
    assert req2.result == {"decision": "deny", "reason": "shutdown"}
    assert req1.event.is_set()
    assert req2.event.is_set()
    assert len(bridge._pending) == 0


# TEST-012: 同一 correlation_id の二重クリックが1回目のみ反映される
@pytest.mark.asyncio
async def test_double_resolve():
    bridge = RequestBridge()
    req = bridge.create_request("permission")
    cid = req.correlation_id

    bridge.resolve(cid, {"decision": "allow"})
    assert not bridge.has_pending(cid)

    # 2回目: has_pending が False を返す
    bridge.resolve(cid, {"decision": "deny"})
    # 1回目の結果が保持されている
    assert req.result == {"decision": "allow"}


# multiSelect: toggle_selection テスト
def test_toggle_selection():
    bridge = RequestBridge()
    req = bridge.create_request("ask_question")
    req.partial_selections = {}
    cid = req.correlation_id

    # 選択
    result = bridge.toggle_selection(cid, "Q1", "A")
    assert result == ["A"]

    # 追加
    result = bridge.toggle_selection(cid, "Q1", "B")
    assert result == ["A", "B"]

    # 解除
    result = bridge.toggle_selection(cid, "Q1", "A")
    assert result == ["B"]


# multiSelect: confirm_selections テスト
@pytest.mark.asyncio
async def test_confirm_selections():
    bridge = RequestBridge()
    req = bridge.create_request("ask_question")
    req.partial_selections = {"Q1": ["A", "B"], "Q2": ["C"]}
    cid = req.correlation_id

    bridge.confirm_selections(cid)

    assert req.result == {
        "decision": "answered",
        "answers": {"Q1": "A, B", "Q2": "C"},
    }
    assert req.event.is_set()
    assert not bridge.has_pending(cid)


# スレッド相関: register_thread / get_correlation_for_thread
def test_thread_correlation():
    bridge = RequestBridge()

    bridge.register_thread("ts1", "cid1", 0)
    bridge.register_thread("ts2", "cid1", 1)
    bridge.register_thread("ts3", "cid2", 0)

    assert bridge.get_correlation_for_thread("ts1") == ("cid1", 0)
    assert bridge.get_correlation_for_thread("ts2") == ("cid1", 1)
    assert bridge.get_correlation_for_thread("ts3") == ("cid2", 0)
    assert bridge.get_correlation_for_thread("ts_unknown") is None
