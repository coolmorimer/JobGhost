import os

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test_jobghost.db"
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.db.models import Base
from app.db.session import engine
from app.main import app


@pytest_asyncio.fixture(autouse=True)
async def schema():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest_asyncio.fixture
async def client():
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as value:
            yield value
