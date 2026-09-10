"""Checks the frozen backend's automatic extension ticket over real HTTP/WebSocket."""
import asyncio
import json
import os

import httpx
import websockets


async def main() -> None:
    port = int(os.environ.get("JOBGHOST_TEST_PORT", "8770"))
    first = "chrome-extension://" + "a" * 32
    other = "chrome-extension://" + "b" * 32
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"http://127.0.0.1:{port}/api/extension/auto-ticket",
            headers={"origin": first},
        )
        response.raise_for_status()
        ticket = response.json()
        assert ticket["state"] == "ticket"
    try:
        async with websockets.connect(
            f"ws://127.0.0.1:{port}/api/extension/connect", origin=other
        ) as socket:
            await socket.send(json.dumps({"code": ticket["code"]}))
            await socket.recv()
        raise AssertionError("ticket accepted from a different extension")
    except websockets.exceptions.ConnectionClosed as error:
        assert error.code == 1008
    async with websockets.connect(
        f"ws://127.0.0.1:{port}/api/extension/connect", origin=first
    ) as socket:
        await socket.send(json.dumps({"code": ticket["code"]}))
        assert json.loads(await socket.recv()) == {"type": "connected"}
    print("PACKAGED_AUTO_TICKET_OK")


if __name__ == "__main__":
    asyncio.run(main())
