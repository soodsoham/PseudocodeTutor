from pydantic import BaseModel
from typing import Optional


class ProblemCard(BaseModel):
    description: str
    inputs: str
    outputs: str
    constraints: str = ""


class HintRequest(BaseModel):
    problem_card: ProblemCard
    pseudocode: str
    attempt_count: int
    board: str
    block_id: str


class HintResponse(BaseModel):
    hint: Optional[str] = None
    suggest_trace: bool = False
