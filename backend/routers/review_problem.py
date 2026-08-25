from fastapi import APIRouter
from pydantic import BaseModel
import httpx
import json
import re
from config import settings

router = APIRouter()


class ReviewProblemRequest(BaseModel):
    title: str
    problem: str
    board: str = "CIE IGCSE"
    pdf_text: str = ""
    attachment_text: str = ""


class ReviewProblemResponse(BaseModel):
    approved: bool
    reason: str


GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{settings.GEMINI_MODEL}:generateContent"
)


HARD_REJECT_PATTERNS = [
    (r"\bpussy\b", "Contains explicit sexual profanity."),
    (r"\bfuck(?:ing)?\b", "Contains explicit abusive language."),
    (r"\bcunt\b", "Contains explicit abusive language."),
    (r"\bnigg(?:er|a)\b", "Contains hateful slur."),
    (r"\bwhore\b", "Contains explicit abusive language."),
    (r"\bslut\b", "Contains explicit abusive language."),
    (r"\bblowjob\b", "Contains explicit sexual content."),
    (r"\b(?:porn|pornographic)\b", "Contains sexual content."),
    (r"\b(?:rape|rapist)\b", "Contains sexual violence content."),
    (r"\b(?:heil hitler|white supremacy|ethnic cleansing)\b", "Contains extremist propaganda content."),
    (r"\b(?:join isis|join jihad)\b", "Contains extremist propaganda content."),
    (r"\bdeath\s+to\s+[a-z0-9][a-z0-9\s\-]{1,50}\b", "Contains violent hate/incitement slogan."),
    (r"\bkill\s+all\s+[a-z0-9][a-z0-9\s\-]{1,50}\b", "Contains violent hate/incitement slogan."),
    (r"\b(?:exterminate|wipe\s+out)\s+[a-z0-9][a-z0-9\s\-]{1,50}\b", "Contains violent hate/incitement slogan."),
]

NORMALIZED_HARD_REJECT_TERMS = {
    "pussy": "Contains explicit sexual profanity.",
    "fucking": "Contains explicit abusive language.",
    "fuck": "Contains explicit abusive language.",
    "cunt": "Contains explicit abusive language.",
    "nigger": "Contains hateful slur.",
    "nigga": "Contains hateful slur.",
    "whore": "Contains explicit abusive language.",
    "slut": "Contains explicit abusive language.",
    "blowjob": "Contains explicit sexual content.",
    "porn": "Contains sexual content.",
    "pornographic": "Contains sexual content.",
    "rape": "Contains sexual violence content.",
    "rapist": "Contains sexual violence content.",
    "heilhitler": "Contains extremist propaganda content.",
    "whitesupremacy": "Contains extremist propaganda content.",
    "ethniccleansing": "Contains extremist propaganda content.",
    "joinisis": "Contains extremist propaganda content.",
    "joinjihad": "Contains extremist propaganda content.",
    "deathtoisrael": "Contains violent hate/incitement slogan.",
    "deathtojews": "Contains violent hate/incitement slogan.",
    "deathtoarabs": "Contains violent hate/incitement slogan.",
    "killalljews": "Contains violent hate/incitement slogan.",
    "killallmuslims": "Contains violent hate/incitement slogan.",
    "killallarabs": "Contains violent hate/incitement slogan.",
    "exterminatejews": "Contains violent hate/incitement slogan.",
    "exterminatemuslims": "Contains violent hate/incitement slogan.",
}


def _normalized_safety_text(text: str) -> str:
    mapped = (
        text.lower()
        .replace("$", "s")
        .replace("@", "a")
        .replace("0", "o")
        .replace("1", "i")
        .replace("3", "e")
        .replace("4", "a")
        .replace("5", "s")
        .replace("7", "t")
    )
    return re.sub(r"[^a-z0-9]+", "", mapped)


def _hard_reject_reason(title: str, problem: str, pdf_text: str = "", attachment_text: str = "") -> str:
    text = f"{title}\n{problem}\n{pdf_text}\n{attachment_text}".lower()
    for pattern, reason in HARD_REJECT_PATTERNS:
        if re.search(pattern, text, flags=re.IGNORECASE):
            return reason

    normalized = _normalized_safety_text(text)
    for term, reason in NORMALIZED_HARD_REJECT_TERMS.items():
        if term in normalized:
            return reason
    return ""


@router.post("/review-problem", response_model=ReviewProblemResponse)
async def review_problem(req: ReviewProblemRequest):
    if req.attachment_text.strip() and not req.pdf_text.strip():
        return ReviewProblemResponse(
            approved=False,
            reason="Attachment content could not be verified from text extraction.",
        )

    hard_reject_reason = _hard_reject_reason(
        req.title,
        req.problem,
        req.pdf_text,
        req.attachment_text,
    )
    if hard_reject_reason:
        return ReviewProblemResponse(approved=False, reason=hard_reject_reason)

    prompt = f"""You are a moderation gate for a student pseudocode platform.
Review this problem and decide if it should be publicly listed.

Title: {req.title}
Board: {req.board}
Problem/Text/PDF-extracted text: {req.problem}
Attachment/PDF text: {req.attachment_text}
PDF extracted text: {req.pdf_text}

Reject ONLY when it is clearly:
- Inappropriate or abusive
- Propaganda/extremist persuasion
- Provocative/inciting harmful conflict
- Non-educational spam or unrelated content

If it is educational and safe, approve even if wording/format is imperfect.

Return ONLY one JSON object in this exact format:
{{"approved": true/false, "reason": "short reason"}}"""

    if not settings.GEMINI_API_KEY:
        return ReviewProblemResponse(
            approved=True, reason="AI key not configured. Auto-approved."
        )

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{GEMINI_URL}?key={settings.GEMINI_API_KEY}",
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "maxOutputTokens": 150,
                        "temperature": 0.1,
                    },
                },
                timeout=20,
            )
            data = response.json()
            text = (
                data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
                .strip()
            )

            approved = False
            reason = "AI review completed."
            parsed = None

            try:
                parsed = json.loads(text)
            except Exception:
                start = text.find("{")
                end = text.rfind("}")
                if start != -1 and end != -1 and end > start:
                    try:
                        parsed = json.loads(text[start : end + 1])
                    except Exception:
                        parsed = None

            if isinstance(parsed, dict):
                approved = bool(parsed.get("approved", False))
                if parsed.get("reason") is not None:
                    reason = str(parsed.get("reason")).strip() or reason
            else:
                lowered = text.lower()
                approved = '"approved": true' in lowered or '"approved":true' in lowered
                if '"reason"' in lowered:
                    reason = text
                reason = reason or "AI review completed."

            return ReviewProblemResponse(
                approved=approved,
                reason=reason or ("AI approved." if approved else "AI rejected."),
            )
    except Exception:
        return ReviewProblemResponse(
            approved=True, reason="AI review unavailable. Defaulting to approved."
        )
