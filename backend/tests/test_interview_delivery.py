async def test_hint_published_and_stop_enforced(client, monkeypatch):
    await client.post("/api/vacancies/search?query=Python")
    vacancy = (await client.get("/api/vacancies")).json()[0]
    session = (await client.post("/api/interviews", params={"vacancy_id": vacancy["id"]})).json()
    delivered = []

    async def publish(sid, data):
        delivered.append((sid, data))

    monkeypatch.setattr("app.api.routes.hub.publish", publish)
    payload = {"question": "Почему Python?", "hints": ["Объясните выбор по требованиям"]}
    assert (
        await client.post(f"/api/interviews/{session['id']}/hints", json=payload)
    ).status_code == 200
    assert delivered[0][1]["hints"] == payload["hints"]
    await client.post(f"/api/interviews/{session['id']}/stop")
    assert (
        await client.post(f"/api/interviews/{session['id']}/hints", json=payload)
    ).status_code == 409
    assert (
        await client.post(f"/api/interviews/{session['id']}/transcript", json={"text": "Test"})
    ).status_code == 409


async def test_unknown_vacancy(client):
    assert (
        await client.post("/api/interviews", params={"vacancy_id": "missing"})
    ).status_code == 400
