"""Exercise all MCP tools against an isolated, seeded audit database."""
import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    root = Path(__file__).resolve().parents[1]
    env = dict(os.environ, DATABASE_URL="sqlite+aiosqlite:///E:/JobGhost/.jobghost/audit/runtime.db", DRY_RUN="true", APPLICATION_COOLDOWN_SECONDS="0")
    params = StdioServerParameters(command=sys.executable, args=["-m", "app.mcp.server"], cwd=str(root / "backend"), env=env)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as s:
            await s.initialize()

            async def call(name, **args):
                r = await s.call_tool(name, args)
                print(name, "FAIL" if r.isError else "PASS")
                if r.isError:
                    return None
                data = r.structuredContent
                if data is None:
                    data = json.loads(r.content[0].text)
                return data.get("result", data) if isinstance(data, dict) else data

            profile = await call("get_candidate_profile")
            await call("update_candidate_profile", profile={k: v for k, v in profile.items() if k not in ("id", "updated_at")})
            resumes = await call("list_resumes")
            await call("get_resume", resume_id=resumes[0]["id"])
            await call("list_search_profiles")
            await call("search_vacancies", query="Python")
            await call("get_new_vacancies")
            queue = await call("get_vacancies_for_scoring")
            vid = queue[0]["id"]
            await call("get_vacancy", vacancy_id=vid)
            score = {"vacancy_id": vid, "score": 90, "decision": "apply", "best_resume_id": resumes[0]["id"]}
            await call("save_vacancy_score", score=score)
            await call("save_vacancy_scores", scores=[score])
            await call("get_best_vacancies")
            app = await call("prepare_application", data={"vacancy_id": vid, "resume_id": resumes[0]["id"]})
            aid = app["id"]
            await call("save_cover_letter", application_id=aid, cover_letter="DEMO verification only. " * 30)
            await call("apply_to_vacancy", application_id=aid)
            await call("get_applications")
            await call("get_application", application_id=aid)
            await call("get_unread_messages")
            await call("get_employer_messages", application_id=aid)
            await call("send_hr_reply", application_id=aid, text="DEMO draft", draft=True)
            await call("get_statistics")
            interview = await call("start_interview_session", vacancy_id=vid)
            sid = interview["id"]
            await call("get_interview_context", session_id=sid)
            await call("get_recent_interview_transcript", session_id=sid)
            await call("save_interview_hint", session_id=sid, hint={"question": "DEMO?", "hints": ["one", "two", "three"]})
            await call("save_interview_summary", session_id=sid, summary={"summary": "DEMO audit"})
            await call("stop_interview_session", session_id=sid)
            await call("ignore_vacancy", vacancy_id=vid)
            for uri in ("candidate://profile", f"vacancy://{vid}", f"application://{aid}", f"interview://{sid}"):
                await s.read_resource(uri)
                print("resource", uri.split(":")[0], "PASS")


if __name__ == "__main__":
    asyncio.run(main())
