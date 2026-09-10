import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api import chat_browser, extension
from app.connectors.chat_bridge import ChatBridge

ORIGIN = 'chrome-extension://' + 'a' * 32


@pytest.fixture
def socket_client(monkeypatch):
    bridge = ChatBridge()
    monkeypatch.setattr(extension, 'chat_bridge', bridge)
    monkeypatch.setattr(chat_browser, 'chat_browser', bridge)
    app = FastAPI()
    app.include_router(extension.router)
    app.include_router(chat_browser.router)
    with TestClient(app, base_url='http://test') as client:
        yield client


def test_socket_rejects_web_origin(socket_client):
    with pytest.raises(WebSocketDisconnect):
        with socket_client.websocket_connect('/api/extension/connect', headers={'origin':'https://evil.example'}):
            pass


def test_socket_rejects_microsoft_edge(socket_client):
    with pytest.raises(WebSocketDisconnect):
        with socket_client.websocket_connect('/api/extension/connect', headers={'origin':ORIGIN,'user-agent':'Chrome/152 Edg/152'}):
            pass


def test_auto_ticket_requires_extension_origin_and_is_single_use(socket_client):
    assert socket_client.post('/api/extension/auto-ticket', headers={'origin':'https://evil.example'}).status_code == 403
    ticket=socket_client.post('/api/extension/auto-ticket', headers={'origin':ORIGIN}).json()
    assert ticket['state']=='ticket' and len(ticket['code'])==43
    with socket_client.websocket_connect('/api/extension/connect',headers={'origin':'chrome-extension://'+'b'*32}) as wrong:
        wrong.send_json({'code':ticket['code']})
        with pytest.raises(WebSocketDisconnect):wrong.receive_json()
    with socket_client.websocket_connect('/api/extension/connect',headers={'origin':ORIGIN}) as ws:
        ws.send_json({'code':ticket['code']});assert ws.receive_json()=={'type':'connected'}
        assert socket_client.post('/api/extension/auto-ticket',headers={'origin':ORIGIN}).json()=={'state':'connected'}
    with socket_client.websocket_connect('/api/extension/connect',headers={'origin':ORIGIN}) as replay:
        replay.send_json({'code':ticket['code']})
        with pytest.raises(WebSocketDisconnect):replay.receive_json()


@pytest.mark.parametrize('auth', [{'code':'wrong'}, [], None])
def test_socket_rejects_bad_auth(socket_client, auth):
    socket_client.post('/api/extension/pair', json={})
    with socket_client.websocket_connect('/api/extension/connect', headers={'origin':ORIGIN}) as ws:
        ws.send_json(auth)
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_socket_roundtrip_and_token_replay(socket_client):
    code = socket_client.post('/api/extension/pair', json={}).json()['code']
    with socket_client.websocket_connect('/api/extension/connect', headers={'origin':ORIGIN}) as ws:
        ws.send_json({'code':code})
        assert ws.receive_json() == {'type':'connected'}
        ws.send_json({'type':'heartbeat', 'ready':True})
        assert socket_client.get('/api/chat-browser/status').json()['state'] == 'ready'


def test_socket_diagnostics_returns_only_safe_fields(socket_client):
    code = socket_client.post('/api/extension/pair', json={}).json()['code']
    with socket_client.websocket_connect('/api/extension/connect', headers={'origin':ORIGIN}) as ws:
        ws.send_json({'code':code})
        assert ws.receive_json() == {'type':'connected'}
        ws.send_json({'type':'heartbeat', 'ready':True})
        with ThreadPoolExecutor() as executor:
            future = executor.submit(socket_client.post, '/api/chat-browser/diagnostics', json={'question':'fixture'})
            message = ws.receive_json()
            assert message['type'] == 'diagnostic'
            ws.send_json({'type':'result','id':message['id'],'diagnostic':{'users':2,'answers':2,'prefix_match':True,'leak':'private'}})
            response = future.result(timeout=5)
            assert response.status_code == 200
            assert response.json() == {'users':2,'answers':2,'prefix_match':True}
        with ThreadPoolExecutor() as executor:
            future = executor.submit(socket_client.post, '/api/chat-browser/ask', json={'question':'protocol fixture'})
            message = ws.receive_json()
            assert message['question'] == 'protocol fixture'
            ws.send_json({'type':'result','id':message['id'],'answer':'fixture response, not live AI'})
            response = future.result(timeout=5)
            assert response.status_code == 200
            assert response.json() == {'answer':'fixture response, not live AI','channel':'chatgpt_extension'}
        with socket_client.websocket_connect('/api/extension/connect', headers={'origin':ORIGIN}) as other:
            other.send_json({'code':code})
            with pytest.raises(WebSocketDisconnect):
                other.receive_json()
        assert socket_client.get('/api/chat-browser/status').json()['state'] == 'ready'


def test_revoked_code_cannot_connect(socket_client):
    code = socket_client.post('/api/extension/pair', json={}).json()['code']
    socket_client.post('/api/extension/disconnect', json={})
    with socket_client.websocket_connect('/api/extension/connect', headers={'origin':ORIGIN}) as ws:
        ws.send_json({'code':code})
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_server_requests_heartbeat_without_client_timer(socket_client, monkeypatch):
    monkeypatch.setattr(extension, 'HEARTBEAT_INTERVAL', 0.05)
    code = socket_client.post('/api/extension/pair', json={}).json()['code']
    with socket_client.websocket_connect('/api/extension/connect', headers={'origin':ORIGIN}) as ws:
        ws.send_json({'code':code})
        assert ws.receive_json() == {'type':'connected'}
        assert socket_client.get('/api/chat-browser/status').json()['reason'] == 'awaiting_heartbeat'
        assert ws.receive_json() == {'type':'ping'}
        ws.send_json({'type':'heartbeat', 'ready':False, 'reason':'tab_unavailable'})
        assert socket_client.get('/api/chat-browser/status').json()['reason'] == 'tab_unavailable'
        ws.send_json({'type':'heartbeat', 'ready':True})
        assert socket_client.get('/api/chat-browser/status').json()['state'] == 'ready'
        extension.chat_bridge.last_seen = time.monotonic() - 30
        ws.send_json({'type':'keepalive'})
        time.sleep(0.02)
        assert socket_client.get('/api/chat-browser/status').json()['state'] == 'ready'
