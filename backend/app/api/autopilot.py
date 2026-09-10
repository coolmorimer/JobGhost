from fastapi import APIRouter, Depends

from app.api.hh_browser import local_request
from app.workers.autopilot import PilotConfig, autopilot

router = APIRouter(prefix="/api/autopilot", dependencies=[Depends(local_request)])


@router.get("/status")
async def status():
    return dict(autopilot.state)


@router.post("/start")
async def start(config: PilotConfig):
    return await autopilot.start(config)


@router.post("/pause")
async def pause():
    return await autopilot.pause()
