.PHONY: install dev backend frontend mcp test lint format migrate seed
install:
	python -m venv backend/.venv && backend/.venv/bin/pip install -e 'backend[dev]' && npm --prefix frontend install
dev:
	docker compose up --build
backend:
	cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8765
frontend:
	npm --prefix frontend run dev
mcp:
	cd backend && .venv/bin/python -m app.mcp.server
test:
	cd backend && .venv/bin/python -m pytest && npm --prefix frontend test
lint:
	cd backend && .venv/bin/python -m ruff check . && .venv/bin/python -m mypy app && npm --prefix frontend run lint
format:
	cd backend && .venv/bin/python -m ruff format . && npm --prefix frontend run format
migrate:
	cd backend && .venv/bin/python -m alembic upgrade head
seed:
	cd backend && .venv/bin/python -c "import asyncio; from app.db.session import SessionLocal; from app.services.core import seed; async def x():\n async with SessionLocal() as d: await seed(d)\nasyncio.run(x())"

