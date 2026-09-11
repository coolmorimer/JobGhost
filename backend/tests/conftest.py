import os

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test_jobghost.db"
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.db.models import Base
from app.db.session import engine
from app.main import app


@pytest.fixture(autouse=True)
def isolate_user_data(monkeypatch, tmp_path):
    monkeypatch.setenv("JOBGHOST_USER_DATA", str(tmp_path))
    monkeypatch.setattr("app.services.ai_provider.ai_provider._key", lambda provider: "")


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
