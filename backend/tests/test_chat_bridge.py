import asyncio
import time

import pytest

from app.connectors.chat_bridge import ChatBridge


class Socket:
    def __init__(self):
        self.messages = asyncio.Queue()
        self.closed = False

    async def send_json(self, value):
        await self.messages.put(value)

    async def close(self):
        self.closed = True


async def test_bridge_pair_is_single_use_lifetime_and_disconnect():
    bridge = ChatBridge()
    first = await bridge.pair()
    assert len(first["code"]) == 43
    assert first["expires_seconds"] == 120
    second = await bridge.pair()
    assert first["code"] != second["code"]
    await bridge.close()
    assert bridge.token == ""
    assert (await bridge.status())["state"] != "ready"


async def test_bridge_requires_fresh_authenticated_connection():
    bridge = ChatBridge()
    with pytest.raises(ValueError, match="не подключено"):
        await bridge.ask("question")
    bridge.socket = Socket()
    bridge.ready = True
    bridge.last_seen = time.monotonic() - 30
    with pytest.raises(ValueError, match="не подключено"):
        await bridge.ask("question")
    assert bridge.socket.messages.empty()
    assert (await bridge.status())["reason"] == "heartbeat_expired"


async def test_status_distinguishes_missing_editor_and_unknown_page_state():
    bridge = ChatBridge()
    assert (await bridge.status())["reason"] == "disconnected"
    bridge.socket = Socket()
    assert (await bridge.status())["reason"] == "awaiting_heartbeat"
    bridge.last_seen = time.monotonic()
    bridge.page_state = "editor_unavailable"
    assert "поле ввода недоступно" in (await bridge.status())["message"]


async def test_bridge_question_result_and_busy_guard():
    bridge = ChatBridge()
    bridge.socket = Socket()
    bridge.ready = True
    bridge.last_seen = time.monotonic()
    task = asyncio.create_task(bridge.ask("question"))
    message = await asyncio.wait_for(bridge.socket.messages.get(), 1)
    assert message["question"] == "question"
    with pytest.raises(ValueError, match="ещё выполняется"):
        await bridge.ask("duplicate")
    bridge.pending[message["id"]].set_result({"answer": "fixture"})
    assert await task == {"answer": "fixture"}
    assert not bridge.pending
    assert bridge.socket.messages.empty()


async def test_disconnect_rejects_pending_without_retry():
    bridge = ChatBridge()
    bridge.socket = Socket()
    bridge.ready = True
    bridge.last_seen = time.monotonic()
    task = asyncio.create_task(bridge.ask("question"))
    socket = bridge.socket
    await asyncio.wait_for(socket.messages.get(), 1)
    await bridge.close()
    with pytest.raises(ValueError, match="отключён"):
        await task
    assert socket.closed and socket.messages.empty()
    assert not bridge.pending


async def test_pair_origin_and_revoke(client):
    response = await client.post(
        "/api/extension/pair", json={}, headers={"Origin": "https://evil.example"}
    )
    assert response.status_code == 403
    response = await client.post("/api/extension/pair", json={})
    assert len(response.json()["code"]) == 43
    assert (await client.post("/api/extension/disconnect", json={})).status_code == 200
