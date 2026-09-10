"""Non-production integration probes. Run against the isolated audit server only."""
import asyncio
import json

import httpx
import websockets


async def main():
    findings = []

    def check(name, ok, detail):
        findings.append({"check": name, "pass": bool(ok), "detail": detail})

    async with httpx.AsyncClient(base_url="http://127.0.0.1:8765") as c:
        check("health", (await c.get("/api/health")).status_code == 200, "HTTP health")
        first = (await c.post("/api/vacancies/search")).json()
        second = (await c.post("/api/vacancies/search")).json()
        check("deduplication", second["saved"] == 0, {"first": first, "second": second})
        vacancies = (await c.get("/api/vacancies")).json()
        resumes = (await c.get("/api/resumes")).json()
        vid = vacancies[0]["id"]
        score = {"vacancy_id": vid, "score": 90, "decision": "apply"}
        check("score", (await c.post("/api/scores", json=score)).status_code == 200, "save 90")
        draft = (await c.post("/api/applications", json={"vacancy_id": vid, "resume_id": resumes[0]["id"]})).json()
        sent = (await c.post(f"/api/applications/{draft['id']}/send")).json()
        check("dry_run", sent.get("dry_run") and sent.get("status") == "APPLIED", "simulated dispatch")
        duplicate = await c.post(f"/api/applications/{draft['id']}/send")
        check("duplicate_send_blocked", duplicate.status_code == 400, duplicate.status_code)
        invalid = await c.post("/api/applications", json={"vacancy_id": "missing-vacancy", "resume_id": "missing-resume"})
        check("invalid_application_rejected", invalid.status_code in (400, 404, 422), invalid.status_code)
        session = (await c.post("/api/interviews", params={"vacancy_id": vid})).json()
        sid = session["id"]
        url = f"ws://127.0.0.1:8765/api/ws/interview/{sid}?token={session['token']}"
        try:
            async with websockets.connect(url + "invalid"):
                check("ws_auth", False, "accepted bad token")
        except websockets.exceptions.InvalidStatus as exc:
            check("ws_auth", exc.response.status_code == 403, exc.response.status_code)
        async with websockets.connect(url) as ws:
            await ws.send(json.dumps({"type": "transcript", "text": "Как устроен event loop?"}))
            msg = json.loads(await asyncio.wait_for(ws.recv(), 2))
            check("ws_transcript_echo", msg.get("text") == "Как устроен event loop?", "echo")
            transcript = (await c.get(f"/api/interviews/{sid}/transcript")).json()
            check("transcript_persisted", bool(transcript and transcript[-1]["is_question"]), len(transcript))
            r = await c.post(f"/api/interviews/{sid}/hints", json={"question": "test", "hints": ["one", "two", "three"]})
            check("hint_saved", r.status_code == 200, r.status_code)
            try:
                await asyncio.wait_for(ws.recv(), 1)
                check("hint_broadcast", True, "received")
            except TimeoutError:
                check("hint_broadcast", False, "API saves hint but no websocket event arrives")
            await c.post(f"/api/interviews/{sid}/stop")
            post_stop = await c.post(f"/api/interviews/{sid}/transcript", json={"text": "after stop"})
            check("stopped_session_rejects_transcript", post_stop.status_code in (400, 409), post_stop.status_code)
        for endpoint in ("/api/settings", "/api/interviews", f"/api/applications/{draft['id']}"):
            response = await c.get(endpoint)
            check(f"GET {endpoint.split(draft['id'])[0]}", response.status_code == 200, response.status_code)
        score["score"] = 10
        score["decision"] = "skip"
        await c.post("/api/scores", json=score)
        best = (await c.get("/api/vacancies", params={"score_min": 85})).json()
        check("latest_score_filter", vid not in [v["id"] for v in best], "old score 90 then latest score 10")
    print(json.dumps(findings, ensure_ascii=True, indent=2))
    print(f"RESULT {sum(x['pass'] for x in findings)}/{len(findings)} passed")


if __name__ == "__main__":
    asyncio.run(main())
