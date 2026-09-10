import asyncio
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main() -> None:
    backend = Path(__file__).resolve().parents[1]
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "app.mcp.server"],
        cwd=str(backend),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            assert len(tools.tools) >= 15
            result = await session.call_tool("get_candidate_profile", {})
            assert not result.isError
            print(f"MCP handshake OK: {len(tools.tools)} tools; profile tool OK")


if __name__ == "__main__":
    asyncio.run(main())
