import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.api.ai import router as ai_router
from app.api.autopilot import router as pilot_router
from app.api.chat_browser import router as chat_router
from app.api.extension import router as extension_router
from app.api.hh_browser import router as hh_router
from app.api.letters import router as letters_router
from app.api.routes import router
from app.api.speech import router as speech_router
from app.connectors.chat_bridge import chat_bridge as chat_browser
from app.connectors.hh_browser import hh_browser
from app.db.models import Base
from app.db.session import SessionLocal, engine
from app.services.ai_provider import ai_provider
from app.services.core import seed
from app.workers.autopilot import autopilot


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        await seed(db)
    try:
        await autopilot.restore()
        yield
    finally:
        await autopilot.shutdown()
        await hh_browser.close()
        await chat_browser.close()
        await ai_provider.close()


app = FastAPI(title="JobGhost API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(hh_router)
app.include_router(pilot_router)
app.include_router(speech_router)
app.include_router(ai_router)
app.include_router(chat_router)
app.include_router(letters_router)
app.include_router(extension_router)


@app.get("/interview/companion", response_class=HTMLResponse)
async def companion() -> str:
    return """<!doctype html><html lang='ru'><meta name='viewport' content='width=device-width'><style>body{background:#080b12;color:#eef2ff;font:18px system-ui;padding:24px}.card{background:#111827;border:1px solid #263149;border-radius:18px;padding:22px;margin:12px 0}input,button{padding:12px;border-radius:10px;border:0;margin:4px}button{background:#6d5dfc;color:white}</style><h1>JobGhost Companion</h1><div class='card'><input id=s placeholder='Session ID'><input id=t placeholder='Одноразовый token'><button onclick=go()>Подключить</button></div><div class='card'><small>Текущий вопрос</small><h2 id=q>Ожидание…</h2><ul id=h></ul><div id=timer></div></div><script>function go(){let w=new WebSocket(`ws://${location.host}/api/ws/interview/${s.value}?token=${encodeURIComponent(t.value)}`);w.onmessage=e=>{let d=JSON.parse(e.data);if(d.question)q.textContent=d.question;if(d.hints)h.innerHTML=d.hints.map(x=>`<li>${x}</li>`).join('')}}let n=0;setInterval(()=>timer.textContent=`${Math.floor(++n/60)}:${String(n%60).padStart(2,'0')}`,1000)</script></html>"""


frontend_dist = Path(os.environ.get('JOBGHOST_FRONTEND_DIR', Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
