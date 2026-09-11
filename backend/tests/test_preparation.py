import json

import pytest
from sqlalchemy import select

from app.db.models import AssistantSession
from app.db.session import SessionLocal
from app.services.ai_provider import ai_provider
from app.services.context import ContextMemory, build_context, memory
from app.services.knowledge import knowledge


@pytest.fixture(autouse=True)
def context_isolation():
    memory.sessions.clear()
    yield
    memory.sessions.clear()


@pytest.fixture
def ready(monkeypatch):
    async def status():
        return {"state": "ready", "provider": "openai", "model": "fixture"}
    monkeypatch.setattr(ai_provider, "status", status)
    monkeypatch.setattr(ai_provider, "options", lambda: {"provider": "openai"})


@pytest.fixture
def retrieval(monkeypatch):
    async def search(question, documents):
        return [{**d, "chunk": 1, "score": 0.9} for d in documents]
    monkeypatch.setattr(knowledge, "search", search)


async def document(client, kind="project"):
    response = await client.post("/api/preparation/documents", json={"title": "Тестовый проект", "kind": kind, "text": "Разработал тестовое приложение Python и PostgreSQL."})
    assert response.status_code == 200
    return response.json()["id"]


async def test_material_redaction_delete_and_origin(client):
    response = await client.post("/api/preparation/documents", json={"title": "Факты", "kind": "experience", "text": "Писал сервис. example@example.org Телефон +7 (999) 123-45-67"})
    doc_id = response.json()["id"]
    docs = (await client.get("/api/preparation/documents")).json()
    assert "example.org" not in docs[0]["text"]
    assert "999" not in docs[0]["text"]
    forbidden = await client.delete(f"/api/preparation/documents/{doc_id}", headers={"Origin": "https://evil.example"})
    assert forbidden.status_code == 403
    assert (await client.delete(f"/api/preparation/documents/{doc_id}")).status_code == 200
    assert (await client.get("/api/preparation/documents")).json() == []


async def test_session_memory_opt_in_and_delete(client, ready):
    async with SessionLocal() as db:
        local = ContextMemory()
        ephemeral = await local.create(db, "ROLE", "Тест", [], False)
        await local.append(db, ephemeral, "QUESTION", "ANSWER")
        assert list(await db.scalars(select(AssistantSession))) == []
        saved = await local.create(db, "ROLE", "Тест", [], True)
        await local.append(db, saved, "QUESTION", "ANSWER")
        restored = ContextMemory()
        assert (await restored.get(db, saved))["turns"][0]["answer"] == "ANSWER"
        await restored.delete(db, saved)
        assert list(await db.scalars(select(AssistantSession))) == []


async def test_session_ask_isolation_and_no_image_storage(client, ready, monkeypatch):
    roles = []
    async def stream(question, image, *, role=None):
        roles.append(role)
        yield "Ответ о Python."
    monkeypatch.setattr(ai_provider, "stream_answer", stream)
    one = (await client.post("/api/ai/session/start", json={"context_mode": "custom", "custom_prompt": "ROLE_ONE", "save_history": True})).json()["session_id"]
    two = (await client.post("/api/ai/session/start", json={"context_mode": "custom", "custom_prompt": "ROLE_TWO"})).json()["session_id"]
    for session_id, question in [(one, "SECRET_QUESTION"), (one, "FOLLOW_UP"), (two, "OTHER")]:
        response = await client.post("/api/ai/ask", json={"question": question, "session_id": session_id})
        assert '"type": "done"' in response.text
    assert "SECRET_QUESTION" in roles[1]
    assert "SECRET_QUESTION" not in roles[2] and "ROLE_ONE" not in roles[2]
    history = (await client.get("/api/preparation/sessions")).json()
    assert len(history) == 1 and len(history[0]["turns"]) == 2
    assert "image" not in history[0]["turns"][0]
    await client.delete(f"/api/preparation/sessions/{one}")
    assert (await client.post("/api/ai/ask", json={"question": "after delete", "session_id": one})).status_code == 409


async def test_context_sources_are_explicit_and_missing_material_fails(client, retrieval):
    doc_id = await document(client, "vacancy")
    async with SessionLocal() as db:
        prompt, sources = await build_context(db, "Python", "BASE", [doc_id])
        assert sources[0]["kind"] == "vacancy"
        assert "Не приписывай пользователю требования вакансии" in prompt
        assert "Тестовый проект" in prompt
    await client.delete(f"/api/preparation/documents/{doc_id}")
    response = await client.post("/api/ai/session/start", json={"context_mode": "custom", "custom_prompt": "ROLE", "document_ids": [doc_id]})
    assert response.status_code == 409


async def test_coach_validates_output_and_uses_custom_role(client, ready, retrieval, monkeypatch):
    roles = []
    async def stream(question, image, **kwargs):
        roles.append(kwargs["role"])
        yield json.dumps({"score": 8, "explanation": "Не хватает примера", "improvements": ["Объяснить транзакции"], "example": "Общий пример без личных достижений"})
    monkeypatch.setattr(ai_provider, "stream_answer", stream)
    response = await client.post("/api/preparation/coach", json={"question": "Что такое ACID?", "answer": "Свойства транзакций", "context_mode": "custom", "custom_prompt": "CUSTOM_ROLE", "resume_id": "must-not-load"})
    assert response.status_code == 200 and response.json()["score"] == 8
    assert "CUSTOM_ROLE" in roles[0]
    async def invalid(*args, **kwargs):
        yield '{"score": 99}'
    monkeypatch.setattr(ai_provider, "stream_answer", invalid)
    assert (await client.post("/api/preparation/coach", json={"question": "Что такое ACID?", "answer": "Свойства транзакций"})).status_code == 409


async def test_plan_exactly_thirty_and_requires_vacancy(client, ready, retrieval, monkeypatch):
    counter = 0
    async def stream(question, image, **kwargs):
        nonlocal counter
        counter += 1
        yield json.dumps({"items": [{"question": f"Вопрос {counter}-{i}?", "answer": "Учебный ответ, не факт опыта"} for i in range(5)], "checklist": ["Повторить Python"]})
    monkeypatch.setattr(ai_provider, "stream_answer", stream)
    assert (await client.post("/api/preparation/plan", json={})).status_code == 422
    doc_id = await document(client, "vacancy")
    response = await client.post("/api/preparation/plan", json={"document_ids": [doc_id]})
    assert response.status_code == 200, response.text
    assert len(response.json()["items"]) == 30 and counter == 6
    assert response.json()["checklist"] == ["Повторить Python"]


async def test_vacancy_import_blocks_non_hh_and_autopilot(client, monkeypatch):
    async def forbidden(url):
        pytest.fail("Invalid URL must not reach browser")
    monkeypatch.setattr("app.api.preparation.hh_browser.read_vacancy", forbidden)
    assert (await client.post("/api/preparation/vacancy", json={"url": "http://127.0.0.1/secret"})).status_code == 409


async def test_qdrant_real_index_filters_and_removes_old_material(monkeypatch):
    import numpy as np
    from qdrant_client import QdrantClient, models

    from app.services.knowledge import KnowledgeIndex
    class Embedding:
        def embed(self, texts):
            return [np.array([1., 0., 0.]) for _ in texts]
        query_embed = embed
    index = KnowledgeIndex()
    index.model = Embedding()
    index.client = QdrantClient(":memory:")
    index.client.create_collection("materials", vectors_config=models.VectorParams(size=3, distance=models.Distance.COSINE))
    first = {"id": "first", "text": "Private project one", "kind": "project", "title": "One", "source": "fixture"}
    second = {**first, "id": "second", "text": "Different project", "title": "Two"}
    assert (await index.search("question", [first]))[0]["id"] == "first"
    hits = await index.search("question", [second])
    assert [h["id"] for h in hits] == ["second"]
    await index.clear()


async def test_structured_requests_require_schema(monkeypatch):
    from app.api.preparation import CoachResult, structured
    captured = {}
    async def stream(*args, **kwargs):
        captured.update(kwargs)
        yield '{"score":8,"explanation":"Точно","improvements":["Добавить пример"],"example":"Общий пример"}'
    monkeypatch.setattr(ai_provider, 'stream_answer', stream)
    await structured('JSON fixture', 'ROLE', CoachResult)
    assert captured['json_schema']['additionalProperties'] is False
    assert set(captured['json_schema']['required']) == {'score', 'explanation', 'improvements', 'example'}
