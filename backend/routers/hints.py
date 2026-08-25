from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from services.hints import get_hint

router = APIRouter()


class HintRequest(BaseModel):
    problem: str = ""
    attachment_text: str = ""
    pdf_text: str = ""
    pseudocode: str = ""
    attempt_count: int = 1
    board: str = "CIE IGCSE"
    language: str = "Python"


class HintResponse(BaseModel):
    hint: Optional[str] = None
    suggest_trace: bool = False
    ideal_solution: Optional[str] = None
    is_correct: bool = False


@router.post("/hints", response_model=HintResponse)
async def hints(req: HintRequest):
    problem_text = req.problem
    attachment_text = req.attachment_text.strip() or req.pdf_text.strip()
    if attachment_text:
        problem_text = (
            f"{problem_text}\n\nAttached PDF context:\n{attachment_text}"
            if problem_text.strip()
            else f"Attached PDF context:\n{attachment_text}"
        )

    result = await get_hint(
        problem=problem_text,
        pseudocode=req.pseudocode,
        attempt_count=req.attempt_count,
        board=req.board,
        language=req.language
    )
    return HintResponse(**result)
