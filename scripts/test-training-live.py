"""Explicit live smoke against an isolated server; sends ONLY synthetic text."""
import asyncio
import argparse
import json
import time

import httpx


async def main():
    async with httpx.AsyncClient(base_url="http://127.0.0.1:8765", timeout=600) as client:
        response = await client.put("/api/ai/settings", json={"provider": args.provider, "openai_model": "gpt-4o-mini", "openrouter_model": "auto"})
        response.raise_for_status()
        started = time.perf_counter()
        response = await client.post("/api/preparation/coach", json={"question": "Что такое транзакция в PostgreSQL?", "answer": "Группа операций, которая выполняется целиком или откатывается. ACID включает атомарность и изоляцию.", "context_mode": "custom", "custom_prompt": "Ты тренер Python интервью. Личный опыт пользователя неизвестен."})
        if response.is_error:
            print(response.text, flush=True)
        response.raise_for_status()
        result = response.json()
        assert 0 <= result["score"] <= 10 and result["improvements"]
        print(json.dumps({"check": "live_coach", "score": result["score"], "elapsed_s": round(time.perf_counter()-started, 2)}), flush=True)
        session = await client.post("/api/ai/session/start", json={"context_mode": "custom", "custom_prompt": "Тестовая роль: тема текущего разговора PostgreSQL. Отвечай кратко. Не придумывай опыт."})
        session.raise_for_status()
        session_id = session.json()["session_id"]
        for question in ["Что такое транзакция?", "О какой базе данных мы говорим? Назови только название."]:
            response = await client.post("/api/ai/ask", json={"question": question, "session_id": session_id})
            response.raise_for_status()
            events = [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]
            assert any(event["type"] == "done" for event in events), events
            answer = "".join(event.get("delta", "") for event in events)
        assert "postgres" in answer.lower(), answer
        await client.delete(f"/api/preparation/sessions/{session_id}")
        print(json.dumps({"check": "live_session_context", "passed": True}), flush=True)
        if args.plan:
            response = await client.post('/api/preparation/load', json={})
            response.raise_for_status()
            response = await client.post('/api/preparation/documents', json={'title': 'TEST Python backend vacancy', 'kind': 'vacancy', 'text': 'Тестовая вакансия для проверки: Python, FastAPI, PostgreSQL, Docker. Разработка HTTP API, тестирование, наблюдаемость, оптимизация запросов. Это синтетические данные, не реальная вакансия.'})
            response.raise_for_status()
            doc_id = response.json()['id']
            try:
                started = time.perf_counter()
                response = await client.post('/api/preparation/plan', json={'document_ids': [doc_id]})
                if response.is_error:
                    print(response.text, flush=True)
                response.raise_for_status()
                plan = response.json()
                assert len(plan['items']) == 30 and plan['checklist']
                print(json.dumps({'check': 'live_plan', 'questions': len(plan['items']), 'checklist': len(plan['checklist']), 'elapsed_s': round(time.perf_counter()-started, 2)}), flush=True)
            finally:
                await client.delete('/api/preparation/documents/'+doc_id)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--confirm-isolated', action='store_true', help='Confirm port 8765 belongs to an isolated test server, never your working app')
parser.add_argument('--provider', choices=['openai', 'openrouter'], default='openai')
parser.add_argument('--plan', action='store_true', help='Also run six plan requests and model download')
args = parser.parse_args()
if not args.confirm_isolated:
    parser.error('Requires --confirm-isolated; changes test provider settings and spends API credits')
asyncio.run(main())
