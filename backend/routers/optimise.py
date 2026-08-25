from fastapi import APIRouter
from models.optimise import OptimiseRequest, OptimiseResponse
from services import gemini

router = APIRouter()


@router.post("/optimise", response_model=OptimiseResponse)
async def optimise(req: OptimiseRequest):
    prompt = f"""You are an expert in {req.board} pseudocode.
Rewrite the following pseudocode to be as clean and idiomatic as possible
for the {req.board} exam board. Keep the same logic. Only output the pseudocode — no explanation.

Problem: {req.problem_card.description}

Student's pseudocode:
{req.student_pseudocode}
"""
    try:
        result = await gemini.generate(prompt, timeout=5.0)
        return OptimiseResponse(optimised_pseudocode=result)
    except Exception:
        return OptimiseResponse(optimised_pseudocode=None, error="unavailable")
