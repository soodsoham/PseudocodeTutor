from fastapi import APIRouter
from pydantic import BaseModel
import httpx
from config import settings

router = APIRouter()


class SolveRequest(BaseModel):
    problem: str
    language: str = "Python"
    board: str = "CIE IGCSE"


class SolveResponse(BaseModel):
    pseudocode: str


GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{settings.GEMINI_MODEL}:generateContent"
)


@router.post("/solve", response_model=SolveResponse)
async def solve(req: SolveRequest):
    prompt = f"""You are a {req.board} Computer Science teacher.
Write a complete pseudocode solution for this problem: {req.problem}
Requirements:
- Use proper {req.board} pseudocode syntax
- Add a comment on each line explaining what it does (use // for comments)
- The solution must be complete and correct
- Only output the pseudocode with comments, nothing else"""

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{GEMINI_URL}?key={settings.GEMINI_API_KEY}",
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"maxOutputTokens": 2000, "temperature": 0.3},
                },
                timeout=20,
            )
            data = response.json()
            pseudocode = data["candidates"][0]["content"]["parts"][0]["text"]
            return SolveResponse(pseudocode=pseudocode.strip())
    except Exception:
        return SolveResponse(pseudocode="// Could not generate solution")
