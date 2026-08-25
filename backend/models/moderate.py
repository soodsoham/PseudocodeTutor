from pydantic import BaseModel
from typing import Literal, Optional


class ModerateRequest(BaseModel):
    content_type: Literal["problem", "past_paper"]
    content_id: str
    reporter_id: Optional[str] = None
    reason: str


class ModerateResponse(BaseModel):
    success: bool
