from pydantic import BaseModel
from typing import Optional
from models.hints import ProblemCard


class OptimiseRequest(BaseModel):
    problem_card: ProblemCard
    student_pseudocode: str
    board: str


class OptimiseResponse(BaseModel):
    optimised_pseudocode: Optional[str] = None
    error: Optional[str] = None
