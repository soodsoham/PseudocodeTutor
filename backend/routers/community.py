from fastapi import APIRouter, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List, Union, Any, Dict
import asyncio
import httpx
import json
import re
import base64
import mimetypes
from pathlib import Path
from uuid import uuid4
from config import settings

router = APIRouter()

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{settings.GEMINI_MODEL}:generateContent"
)
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_MULTIMODAL_MODELS = [
    settings.GEMINI_MODEL,
    "gemini-flash-latest",
]


async def _ask_gemini(prompt: str, max_tokens: int = 2000, timeout: float = 20.0) -> str:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{GEMINI_URL}?key={settings.GEMINI_API_KEY}",
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.3},
            },
            timeout=timeout,
        )
        data = response.json()
        if "error" in data:
            raise RuntimeError(data["error"].get("message", "Gemini error"))
        parts = data["candidates"][0]["content"]["parts"]
        text_parts = [p["text"] for p in parts if not p.get("thought") and p.get("text")]
        return " ".join(text_parts).strip()


class SubmitCommunityProblemRequest(BaseModel):
    title: str
    description: str
    difficulty: str
    board: str
    moderation_status: str = "pending"
    inputs: str = ""
    outputs: str = ""
    constraints: str = ""
    pdf_text: str = ""
    attachment_text: str = ""
    attachment_image_samples: List[str] = []
    created_by: Optional[str] = None


class SubmitCommunityProblemResponse(BaseModel):
    ok: bool
    problem_id: Optional[str] = None
    error: Optional[str] = None
    moderation_status: Optional[str] = None
    review_reason: Optional[str] = None


class UploadAttachmentRequest(BaseModel):
    file_name: str
    content_base64: str
    file_type: str = "application/pdf"


class UpdateCommunityProblemRequest(BaseModel):
    problem_id: str
    title: str
    description: str
    difficulty: str
    board: str


class UpdateCommunityProblemResponse(BaseModel):
    ok: bool
    error: Optional[str] = None


class DeleteCommunityProblemRequest(BaseModel):
    problem_id: str


class DeleteCommunityProblemResponse(BaseModel):
    ok: bool
    error: Optional[str] = None


BOARD_LABELS = {
    "cie-igcse": "CIE IGCSE",
    "cie-a-level": "CIE A Level",
    "pearson-igcse": "Pearson IGCSE",
    "pearson-a-level": "Pearson A Level",
    "aqa-gcse": "AQA GCSE",
    "aqa-a-level": "AQA A Level",
}


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


ATTACHMENTS_DIR = Path(__file__).resolve().parents[1] / "data" / "community_attachments"
ATTACHMENTS_INDEX_PATH = Path(__file__).resolve().parents[1] / "data" / "community_attachments_index.json"
MAX_PDF_BYTES = 10 * 1024 * 1024


def _ensure_attachment_store() -> None:
    ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
    ATTACHMENTS_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not ATTACHMENTS_INDEX_PATH.exists():
        ATTACHMENTS_INDEX_PATH.write_text("{}", encoding="utf-8")


def _load_attachment_index() -> Dict[str, List[Dict[str, str]]]:
    _ensure_attachment_store()
    try:
        data = json.loads(ATTACHMENTS_INDEX_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def _save_attachment_index(index: Dict[str, List[Dict[str, str]]]) -> None:
    _ensure_attachment_store()
    ATTACHMENTS_INDEX_PATH.write_text(json.dumps(index), encoding="utf-8")


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


def _hard_reject_reason_for_problem(
    *,
    title: str,
    description: str,
    inputs: str = "",
    outputs: str = "",
    constraints: str = "",
    pdf_text: str = "",
    attachment_text: str = "",
) -> Optional[str]:
    text = "\n".join([title, description, inputs, outputs, constraints, pdf_text, attachment_text]).lower()
    for pattern, reason in HARD_REJECT_PATTERNS:
        if re.search(pattern, text, flags=re.IGNORECASE):
            return reason

    normalized = _normalized_safety_text(text)
    for term, reason in NORMALIZED_HARD_REJECT_TERMS.items():
        if term in normalized:
            return reason
    return None


def _parse_ai_review_json(text: str) -> tuple[bool, str]:
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
        raw_reason = parsed.get("reason")
        if raw_reason is not None:
            reason = str(raw_reason).strip() or reason
    else:
        lowered = text.lower()
        approved = '"approved": true' in lowered or '"approved":true' in lowered
        if '"reason"' in lowered:
            reason = text

    return approved, reason


async def _review_problem_with_ai(
    *,
    title: str,
    description: str,
    board: str,
    inputs: str = "",
    outputs: str = "",
    constraints: str = "",
    pdf_text: str = "",
    attachment_text: str = "",
    attachment_image_samples: Optional[List[str]] = None,
) -> tuple[bool, str]:
    if attachment_text.strip() and not pdf_text.strip():
        return False, "Attachment content could not be verified from text extraction."

    hard_reject_reason = _hard_reject_reason_for_problem(
        title=title,
        description=description,
        inputs=inputs,
        outputs=outputs,
        constraints=constraints,
        pdf_text=pdf_text,
        attachment_text=attachment_text,
    )
    if hard_reject_reason:
        return False, hard_reject_reason

    if not settings.GEMINI_API_KEY:
        return False, "AI_UNAVAILABLE: GEMINI_API_KEY is not configured."

    image_samples = attachment_image_samples or []
    if image_samples:
        approved_images, image_reason = await _review_pdf_images_with_ai(image_samples)
        if not approved_images:
            return False, image_reason

    prompt = f"""You are a moderation gate for a student pseudocode learning platform.
Decide if this community problem should be rejected.

Board: {board}
Title: {title}
Description/Text/PDF-extracted text: {description}
Inputs: {inputs}
Outputs: {outputs}
Constraints: {constraints}
Attachment/PDF text: {attachment_text}
PDF extracted text: {pdf_text}

Reject ONLY when the content is clearly:
- Inappropriate or abusive
- Pornographic nudity or sexually explicit content
- Propaganda/extremist persuasion
- Provocative/inciting harmful conflict
- Non-educational spam/unrelated content

If the submission is educational and safe, approve it even if wording/format is imperfect.

Return ONLY one JSON object in this exact format:
{{"approved": true/false, "reason": "short reason"}}"""

    try:
        text = await _ask_gemini(prompt, max_tokens=220, timeout=18.0)
        return _parse_ai_review_json(text)
    except Exception as exc:
        return False, f"AI_UNAVAILABLE: {type(exc).__name__}: moderation could not be completed."


async def _review_pdf_images_with_ai(image_samples: List[str]) -> tuple[bool, str]:
    if not image_samples:
        return True, "No PDF images to review."
    if not settings.GEMINI_API_KEY:
        return False, "AI_UNAVAILABLE: PDF page image moderation is not configured."

    parts: List[Dict[str, Any]] = [
        {
            "text": (
                "You are a strict safety moderator for student platform uploads.\n"
                "Review these PDF page images and reject ONLY if they contain clearly "
                "inappropriate content (pornographic nudity/sexual explicit content), "
                "hateful/extremist symbols or text, violent incitement (including slogans like "
                "\"death to <group/country>\", \"kill all <group>\", \"exterminate <group>\"), or abusive slurs.\n"
                "Educational exam/problem content should be approved.\n"
                "Return ONLY JSON: {\"approved\": true/false, \"reason\": \"short reason\"}."
            )
        }
    ]

    for sample in image_samples[:3]:
        match = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", sample)
        if not match:
            continue
        mime_type = match.group(1)
        data = match.group(2)
        parts.append(
            {
                "inline_data": {
                    "mime_type": mime_type,
                    "data": data,
                }
            }
        )

    if len(parts) == 1:
        return True, "No valid image samples for AI review."

    error_details: List[str] = []
    try:
        async with httpx.AsyncClient() as client:
            for model in GEMINI_MULTIMODAL_MODELS:
                response = await client.post(
                    f"{GEMINI_BASE_URL}/{model}:generateContent?key={settings.GEMINI_API_KEY}",
                    json={
                        "contents": [{"parts": parts}],
                        "generationConfig": {"maxOutputTokens": 180, "temperature": 0.1},
                    },
                    timeout=20.0,
                )
                data = response.json()
                if response.status_code >= 400 or "error" in data:
                    message = str(data.get("error", {}).get("message") or "unknown error")
                    error_details.append(f"{model}: HTTP {response.status_code} {message}")
                    continue

                out_parts = data["candidates"][0]["content"]["parts"]
                text = " ".join(
                    [p.get("text", "") for p in out_parts if p.get("text")]
                ).strip()
                if not text:
                    error_details.append(f"{model}: empty response")
                    continue
                return _parse_ai_review_json(text)

            detail_text = "; ".join(error_details[:2]) if error_details else "no model response"
            return False, f"AI_UNAVAILABLE: PDF page image moderation failed. {detail_text}"
    except Exception as exc:
        return False, f"AI_UNAVAILABLE: PDF page image moderation failed ({type(exc).__name__})."


def _extract_printable_pdf_text(content: bytes, max_chars: int = 12000) -> str:
    try:
        chunks = re.findall(rb"[ -~]{4,}", content)
        if not chunks:
            return ""
        text = " ".join(chunk.decode("latin-1", errors="ignore") for chunk in chunks)
        return text[:max_chars]
    except Exception:
        return ""


async def _review_uploaded_pdf_with_ai(content: bytes, filename: str) -> tuple[bool, str]:
    extracted = _extract_printable_pdf_text(content)
    hard_reject_reason = _hard_reject_reason_for_problem(
        title="",
        description="",
        pdf_text=extracted,
        attachment_text=filename,
    )
    if hard_reject_reason:
        return False, hard_reject_reason

    if not settings.GEMINI_API_KEY:
        return False, "AI_UNAVAILABLE: GEMINI_API_KEY is not configured."

    prompt = (
        "You are a strict moderation gate for a student pseudocode learning platform.\n"
        "Review this uploaded PDF and reject ONLY if it contains pornographic nudity, sexually explicit, abusive, "
        "propaganda/extremist, provocative/inciting harmful conflict, or non-educational spam content.\n"
        "If the PDF is educational and safe, approve it.\n"
        "Pay close attention to hate/violence slogans such as "
        "\"death to <group/country>\", \"kill all <group>\", or \"exterminate <group>\".\n"
        "Return ONLY JSON: {\"approved\": true/false, \"reason\": \"short reason\"}."
    )
    encoded_pdf = base64.b64encode(content).decode("ascii")

    error_details: List[str] = []
    try:
        async with httpx.AsyncClient() as client:
            for model in GEMINI_MULTIMODAL_MODELS:
                response = await client.post(
                    f"{GEMINI_BASE_URL}/{model}:generateContent?key={settings.GEMINI_API_KEY}",
                    json={
                        "contents": [
                            {
                                "parts": [
                                    {"text": prompt},
                                    {
                                        "inline_data": {
                                            "mime_type": "application/pdf",
                                            "data": encoded_pdf,
                                        }
                                    },
                                ]
                            }
                        ],
                        "generationConfig": {"maxOutputTokens": 180, "temperature": 0.1},
                    },
                    timeout=25.0,
                )
                data = response.json()
                if response.status_code >= 400 or "error" in data:
                    message = str(data.get("error", {}).get("message") or "unknown error")
                    error_details.append(f"{model}: HTTP {response.status_code} {message}")
                    continue

                out_parts = data["candidates"][0]["content"]["parts"]
                text = " ".join(
                    [p.get("text", "") for p in out_parts if p.get("text")]
                ).strip()
                if not text:
                    error_details.append(f"{model}: empty response")
                    continue
                return _parse_ai_review_json(text)

            detail_text = "; ".join(error_details[:2]) if error_details else "no model response"
            return False, f"AI_UNAVAILABLE: {detail_text}"
    except Exception as exc:
        return False, f"AI_UNAVAILABLE: {type(exc).__name__}: {str(exc)}"


def _fetch_problem_status_map(supabase: Any, problem_ids: List[Any]) -> Dict[str, str]:
    status_map: Dict[str, str] = {}
    ids = [pid for pid in problem_ids if pid is not None]
    if not ids:
        return status_map

    queue_rows = []
    try:
        queue_result = (
            supabase.table("moderation_queue")
            .select("problem_id,status,created_at")
            .in_("problem_id", ids)
            .order("created_at", desc=True)
            .execute()
        )
        queue_rows = queue_result.data or []
    except Exception:
        queue_rows = []

    if not queue_rows:
        try:
            queue_result = (
                supabase.table("moderation_queue")
                .select("content_id,status,content_type,created_at")
                .eq("content_type", "problem")
                .in_("content_id", ids)
                .order("created_at", desc=True)
                .execute()
            )
            queue_rows = queue_result.data or []
        except Exception:
            queue_rows = []

    for row in queue_rows:
        pid = row.get("problem_id") or row.get("content_id")
        if pid is None:
            continue
        pid_str = str(pid)
        if pid_str not in status_map:
            status_map[pid_str] = str(row.get("status") or "pending").lower()

    return status_map


def _fetch_problem_reason_map(supabase: Any, problem_ids: List[Any]) -> Dict[str, str]:
    reason_map: Dict[str, str] = {}
    ids = [pid for pid in problem_ids if pid is not None]
    if not ids:
        return reason_map

    queue_rows = []
    try:
        queue_result = (
            supabase.table("moderation_queue")
            .select("problem_id,reason,created_at")
            .in_("problem_id", ids)
            .order("created_at", desc=True)
            .execute()
        )
        queue_rows = queue_result.data or []
    except Exception:
        queue_rows = []

    if not queue_rows:
        try:
            queue_result = (
                supabase.table("moderation_queue")
                .select("content_id,reason,content_type,created_at")
                .eq("content_type", "problem")
                .in_("content_id", ids)
                .order("created_at", desc=True)
                .execute()
            )
            queue_rows = queue_result.data or []
        except Exception:
            queue_rows = []

    for row in queue_rows:
        pid = row.get("problem_id") or row.get("content_id")
        if pid is None:
            continue
        pid_str = str(pid)
        if pid_str not in reason_map:
            reason_map[pid_str] = str(row.get("reason") or "")

    return reason_map


def _is_attachment_unverifiable_reject(reason: str) -> bool:
    normalized = (reason or "").strip().lower()
    if "attachment rejected:" in normalized:
        return True
    if "attachment content could not be verified" in normalized:
        return True
    if (
        ("attachment" in normalized or "pdf" in normalized)
        and (
            "moderation failed" in normalized
            or "could not be safely reviewed" in normalized
            or "could not be reviewed" in normalized
            or "not published" in normalized
        )
    ):
        return True
    return False


def _set_problem_status(
    *,
    supabase: Any,
    problem_id: Union[str, int],
    status: str,
    reporter_id: Optional[str] = None,
    reason: Optional[str] = None,
) -> None:
    update_payload: Dict[str, Any] = {"status": status}
    if reason:
        update_payload["reason"] = reason

    updated = False
    try:
        query = supabase.table("moderation_queue").update(update_payload).eq("problem_id", problem_id)
        if reporter_id:
            query = query.eq("reporter_id", reporter_id)
        query.execute()
        updated = True
    except Exception:
        updated = False

    try:
        query = (
            supabase.table("moderation_queue")
            .update(update_payload)
            .eq("content_type", "problem")
            .eq("content_id", problem_id)
        )
        if reporter_id:
            query = query.eq("reporter_id", reporter_id)
        query.execute()
        updated = True
    except Exception:
        pass

    if updated:
        return

    insert_payloads = [
        {
            "problem_id": problem_id,
            "status": status,
            "reporter_id": reporter_id,
            "reason": reason,
        },
        {
            "content_type": "problem",
            "content_id": problem_id,
            "status": status,
            "reporter_id": reporter_id,
            "reason": reason,
        },
        {
            "problem_id": problem_id,
            "status": status,
        },
        {
            "content_type": "problem",
            "content_id": problem_id,
            "status": status,
        },
    ]
    for payload in insert_payloads:
        clean_payload = {k: v for k, v in payload.items() if v is not None}
        try:
            supabase.table("moderation_queue").insert(clean_payload).execute()
            break
        except Exception:
            continue


def _set_problem_row_status(
    *,
    supabase: Any,
    problem_id: Union[str, int],
    status: str,
) -> None:
    update_variants = [
        {"moderation_status": status},
        {"status": status},
        {"is_public": status == "approved"},
        {"moderation_status": status, "is_public": status == "approved"},
        {"status": status, "is_public": status == "approved"},
    ]
    for payload in update_variants:
        try:
            supabase.table("community_problems").update(payload).eq("id", problem_id).execute()
            break
        except Exception:
            continue


@router.get("/community/problems")
async def list_community_problems(
    board: Optional[str] = Query(None),
    difficulty: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(50, le=100),
    offset: int = Query(0),
):
    try:
        from services.supabase_client import get_supabase
        supabase = get_supabase()

        query = supabase.table("community_problems").select(
            "id, title, description, difficulty, board, inputs, outputs, constraints, created_at"
        )

        if board:
            slug = board.strip().lower()
            label = BOARD_LABELS.get(slug, board)
            # Match either stored form (slug or label)
            query = query.or_(f"board.eq.{slug},board.eq.{label}")
        if difficulty:
            query = query.eq("difficulty", difficulty.strip().lower())
        if search:
            query = query.ilike("title", f"%{search.strip()}%")

        query = query.order("created_at", desc=True).range(offset, offset + limit - 1)
        result = query.execute()
        problems = result.data or []

        # Enforce: rejected problems must never appear in community list.
        if problems:
            ids = [p.get("id") for p in problems if p.get("id") is not None]
            status_map = _fetch_problem_status_map(supabase, ids)
            reason_map = _fetch_problem_reason_map(supabase, ids)

            # Auto-correct wrongly flagged rejects:
            # if AI now considers them safe educational content, mark approved.
            for problem in problems:
                pid = problem.get("id")
                if pid is None:
                    continue
                pid_str = str(pid)
                if status_map.get(pid_str) != "rejected":
                    continue
                if _is_attachment_unverifiable_reject(reason_map.get(pid_str, "")):
                    continue

                approved, reason = await _review_problem_with_ai(
                    title=str(problem.get("title") or ""),
                    description=str(problem.get("description") or ""),
                    board=str(problem.get("board") or "CIE IGCSE"),
                    inputs=str(problem.get("inputs") or ""),
                    outputs=str(problem.get("outputs") or ""),
                    constraints=str(problem.get("constraints") or ""),
                )
                if approved:
                    status_map[pid_str] = "approved"
                    _set_problem_status(
                        supabase=supabase,
                        problem_id=pid,
                        status="approved",
                        reason=f"Auto-corrected from rejected: {reason}",
                    )

            filtered = []
            for problem in problems:
                pid_str = str(problem.get("id"))
                moderation_status = status_map.get(pid_str)
                if moderation_status is None:
                    raw_row_status = str(
                        problem.get("moderation_status")
                        or problem.get("status")
                        or ""
                    ).lower()
                    moderation_status = raw_row_status if raw_row_status else None
                if moderation_status == "rejected":
                    continue
                enriched = dict(problem)
                if moderation_status:
                    enriched["moderation_status"] = moderation_status
                filtered.append(enriched)
            problems = filtered

        return {"problems": problems, "total": len(problems)}
    except Exception as exc:
        return {"problems": [], "total": 0, "error": str(exc)}


@router.get("/community/problems/{problem_id}")
async def get_community_problem(problem_id: str):
    try:
        from services.supabase_client import get_supabase
        supabase = get_supabase()

        problem_result = (
            supabase.table("community_problems")
            .select("id, title, description, difficulty, board, inputs, outputs, constraints, created_at")
            .eq("id", problem_id)
            .maybe_single()
            .execute()
        )
        if not problem_result.data:
            return {"problem": None, "solutions": [], "error": "Problem not found"}

        problem = problem_result.data
        status_map = _fetch_problem_status_map(supabase, [problem.get("id")])
        reason_map = _fetch_problem_reason_map(supabase, [problem.get("id")])
        status = status_map.get(str(problem.get("id")))

        if status == "rejected" and not _is_attachment_unverifiable_reject(
            reason_map.get(str(problem.get("id")), "")
        ):
            approved, reason = await _review_problem_with_ai(
                title=str(problem.get("title") or ""),
                description=str(problem.get("description") or ""),
                board=str(problem.get("board") or "CIE IGCSE"),
                inputs=str(problem.get("inputs") or ""),
                outputs=str(problem.get("outputs") or ""),
                constraints=str(problem.get("constraints") or ""),
            )
            if approved:
                status = "approved"
                _set_problem_status(
                    supabase=supabase,
                    problem_id=problem.get("id"),
                    status="approved",
                    reason=f"Auto-corrected from rejected: {reason}",
                )

        if status == "rejected":
            return {"problem": None, "solutions": [], "error": "Problem not found"}

        solutions_result = (
            supabase.table("community_solutions")
            .select("id, pseudocode, author_id, created_at")
            .eq("problem_id", problem_id)
            .order("created_at", desc=False)
            .execute()
        )

        return {
            "problem": problem,
            "solutions": solutions_result.data or [],
        }
    except Exception as exc:
        return {"problem": None, "solutions": [], "error": str(exc)}


@router.post("/community/problems/{problem_id}/attachments")
async def upload_problem_attachment(problem_id: str, req: UploadAttachmentRequest):
    try:
        from services.supabase_client import get_supabase

        filename = req.file_name or "attachment.pdf"
        ext = Path(filename).suffix.lower() or ".pdf"
        content_type = req.file_type or "application/octet-stream"
        if ext != ".pdf" and content_type != "application/pdf":
            return {"ok": False, "error": "Only PDF attachments are supported."}

        try:
            content = base64.b64decode(req.content_base64, validate=True)
        except Exception:
            return {"ok": False, "error": "Attachment data is invalid."}

        if not content:
            return {"ok": False, "error": "Attachment file is empty."}
        if len(content) > MAX_PDF_BYTES:
            return {"ok": False, "error": "PDF must be 10 MB or smaller."}
        if not content.startswith(b"%PDF"):
            return {"ok": False, "error": "Only valid PDF files are supported."}

        supabase = get_supabase()
        problem_result = (
            supabase.table("community_problems")
            .select("*")
            .eq("id", problem_id)
            .maybe_single()
            .execute()
        )
        problem_row = problem_result.data or {}
        if not problem_row:
            return {"ok": False, "error": "Problem not found."}

        approved, review_reason = await _review_uploaded_pdf_with_ai(content, filename)
        if not approved:
            queue_reason = f"Attachment rejected: {review_reason}"
            _set_problem_row_status(
                supabase=supabase,
                problem_id=problem_id,
                status="rejected",
            )
            _set_problem_status(
                supabase=supabase,
                problem_id=problem_id,
                status="rejected",
                reporter_id=None,
                reason=queue_reason,
            )
            if (review_reason or "").startswith("AI_UNAVAILABLE:"):
                return {
                    "ok": False,
                    "error": "Attachment moderation is temporarily unavailable. Your problem was not published. Please retry in a minute.",
                    "moderation_status": "rejected",
                    "review_reason": review_reason,
                }
            return {
                "ok": False,
                "error": "Problem contains inappropriate content in attached PDF and was not published.",
                "moderation_status": "rejected",
                "review_reason": review_reason,
            }

        _ensure_attachment_store()
        stored_name = f"{uuid4().hex}{ext if ext else '.pdf'}"
        path = ATTACHMENTS_DIR / stored_name
        path.write_bytes(content)

        attachment = {
            "id": uuid4().hex,
            "file_name": filename,
            "file_type": "application/pdf" if ext == ".pdf" else content_type,
            "stored_name": stored_name,
            "url": f"/community/attachments/{stored_name}",
        }

        index = _load_attachment_index()
        key = str(problem_id)
        current = index.get(key, [])
        if not isinstance(current, list):
            current = []
        current.append(attachment)
        index[key] = current
        _save_attachment_index(index)

        return {"ok": True, "attachment": attachment}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@router.get("/community/problems/{problem_id}/attachments")
async def list_problem_attachments(problem_id: str):
    try:
        index = _load_attachment_index()
        attachments = index.get(str(problem_id), [])
        if not isinstance(attachments, list):
            attachments = []

        # Backward-compatible fallback if DB row already stores attachment URL/name fields
        try:
            from services.supabase_client import get_supabase
            supabase = get_supabase()
            problem_result = (
                supabase.table("community_problems")
                .select("*")
                .eq("id", problem_id)
                .maybe_single()
                .execute()
            )
            row = problem_result.data or {}
            url = (
                row.get("attachment_url")
                or row.get("pdf_url")
                or row.get("file_url")
            )
            if isinstance(url, str) and url.strip():
                fallback_item = {
                    "id": f"db-{problem_id}",
                    "file_name": str(
                        row.get("attachment_name")
                        or row.get("pdf_filename")
                        or row.get("file_name")
                        or "Attached PDF"
                    ),
                    "file_type": str(row.get("attachment_type") or "application/pdf"),
                    "stored_name": "",
                    "url": url.strip(),
                }
                known_urls = {
                    str(item.get("url"))
                    for item in attachments
                    if isinstance(item, dict)
                }
                if fallback_item["url"] not in known_urls:
                    attachments.append(fallback_item)
        except Exception:
            pass

        return {"attachments": attachments}
    except Exception as exc:
        return {"attachments": [], "error": str(exc)}


@router.get("/community/attachments/{stored_name}")
async def open_problem_attachment(stored_name: str):
    safe_name = Path(stored_name).name
    path = ATTACHMENTS_DIR / safe_name
    if not path.exists() or not path.is_file():
        return {"ok": False, "error": "Attachment not found."}
    media_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return FileResponse(
        path,
        media_type=media_type,
        filename=safe_name,
        content_disposition_type="inline",
    )


@router.post("/community/submit", response_model=SubmitCommunityProblemResponse)
async def submit_community_problem(req: SubmitCommunityProblemRequest):
    try:
        from services.supabase_client import get_supabase

        supabase = get_supabase()

        approved, review_reason = await _review_problem_with_ai(
            title=req.title.strip(),
            description=req.description.strip(),
            board=req.board.strip(),
            inputs=req.inputs.strip(),
            outputs=req.outputs.strip(),
            constraints=req.constraints.strip(),
            pdf_text=req.pdf_text.strip(),
            attachment_text=req.attachment_text.strip(),
            attachment_image_samples=req.attachment_image_samples,
        )
        status = "approved" if approved else "rejected"

        if not approved and review_reason.startswith("AI_UNAVAILABLE:"):
            return SubmitCommunityProblemResponse(
                ok=False,
                error="Content moderation is temporarily unavailable. Nothing was published; please retry in a minute.",
                moderation_status="rejected",
                review_reason=review_reason,
            )

        base_payload = {
            "title": req.title.strip(),
            "description": req.description.strip(),
            "difficulty": req.difficulty.strip().lower(),
            "inputs": req.inputs.strip(),
            "outputs": req.outputs.strip(),
            "constraints": req.constraints.strip(),
        }

        problem_payload_candidates = [
            {
                **base_payload,
                "board": req.board,
                "created_by": req.created_by,
            },
            {
                **base_payload,
                "board": req.board,
            },
        ]

        inserted_data = []
        for payload in problem_payload_candidates:
            try:
                primary = supabase.table("community_problems").insert(payload).execute()
                inserted_data = getattr(primary, "data", None) or []
                if inserted_data:
                    break
            except Exception:
                continue

        if not inserted_data:
            label_board = BOARD_LABELS.get(req.board.strip().lower(), req.board)
            fallback_candidates = [
                {
                    **base_payload,
                    "board": label_board,
                    "created_by": req.created_by,
                },
                {
                    **base_payload,
                    "board": label_board,
                },
            ]
            for payload in fallback_candidates:
                try:
                    fallback = supabase.table("community_problems").insert(payload).execute()
                    inserted_data = getattr(fallback, "data", None) or []
                    if inserted_data:
                        break
                except Exception:
                    continue

        if not inserted_data:
            return SubmitCommunityProblemResponse(
                ok=False,
                error="Insert failed for community_problems.",
                moderation_status=status,
                review_reason=review_reason,
            )

        problem_id = str(inserted_data[0].get("id"))
        _set_problem_row_status(
            supabase=supabase,
            problem_id=inserted_data[0].get("id"),
            status=status,
        )
        moderation_payloads = [
            {
                "problem_id": inserted_data[0].get("id"),
                "status": status,
                "reporter_id": req.created_by,
                "reason": review_reason,
            },
            {
                "content_type": "problem",
                "content_id": inserted_data[0].get("id"),
                "status": status,
                "reporter_id": req.created_by,
                "reason": review_reason,
            },
            {
                "problem_id": inserted_data[0].get("id"),
                "status": status,
                "reason": review_reason,
            },
            {
                "content_type": "problem",
                "content_id": inserted_data[0].get("id"),
                "status": status,
                "reason": review_reason,
            },
        ]

        moderation_inserted = False
        for payload in moderation_payloads:
            try:
                supabase.table("moderation_queue").insert(payload).execute()
                moderation_inserted = True
                break
            except Exception:
                continue

        if not moderation_inserted:
            # Problem was inserted; do not fail the whole request on queue schema mismatch.
            pass

        if status == "rejected":
            return SubmitCommunityProblemResponse(
                ok=False,
                problem_id=problem_id,
                error="Problem contains inappropriate or non-educational/provocative content and was not published. You can review it in My Submissions.",
                moderation_status=status,
                review_reason=review_reason,
            )

        return SubmitCommunityProblemResponse(
            ok=True,
            problem_id=problem_id,
            moderation_status=status,
            review_reason=review_reason,
        )
    except Exception as exc:
        return SubmitCommunityProblemResponse(ok=False, error=str(exc))


@router.get("/community/my-submissions")
async def list_my_submissions(user_id: str = Query(...)):
    try:
        from services.supabase_client import get_supabase
        supabase = get_supabase()

        queue_rows = []
        queue_queries = [
            ("reporter_id", user_id),
            ("created_by", user_id),
            ("user_id", user_id),
        ]

        for field, value in queue_queries:
            try:
                result = (
                    supabase.table("moderation_queue")
                    .select("*")
                    .eq(field, value)
                    .order("created_at", desc=True)
                    .execute()
                )
                queue_rows = result.data or []
                if queue_rows:
                    break
            except Exception:
                continue

        if not queue_rows:
            # Fallback when moderation queue has no user-linking field: try direct problems table
            try:
                direct = (
                    supabase.table("community_problems")
                    .select("*")
                    .eq("created_by", user_id)
                    .order("created_at", desc=True)
                    .execute()
                )
                direct_rows = direct.data or []
                for row in direct_rows:
                    row["moderation_status"] = str(
                        row.get("moderation_status")
                        or row.get("status")
                        or "pending"
                    )
                return {"submissions": direct_rows}
            except Exception:
                return {"submissions": []}

        problem_ids = []
        status_map: Dict[str, str] = {}
        created_at_map: Dict[str, str] = {}
        for row in queue_rows:
            pid = row.get("problem_id") or row.get("content_id")
            if pid is None:
                continue
            pid_str = str(pid)
            if pid_str not in status_map:
                status_map[pid_str] = str(row.get("status") or "pending")
                created_at_map[pid_str] = str(row.get("created_at") or "")
                problem_ids.append(pid)

        if not problem_ids:
            return {"submissions": []}

        problems_result = (
            supabase.table("community_problems")
            .select("*")
            .in_("id", problem_ids)
            .execute()
        )
        problems = problems_result.data or []
        reason_map = _fetch_problem_reason_map(supabase, problem_ids)

        # Auto-correct wrongly rejected problems for uploader view too.
        for problem in problems:
            pid = problem.get("id")
            if pid is None:
                continue
            pid_str = str(pid)
            if status_map.get(pid_str, "").lower() != "rejected":
                continue
            if _is_attachment_unverifiable_reject(reason_map.get(pid_str, "")):
                continue

            approved, reason = await _review_problem_with_ai(
                title=str(problem.get("title") or ""),
                description=str(problem.get("description") or ""),
                board=str(problem.get("board") or "CIE IGCSE"),
                inputs=str(problem.get("inputs") or ""),
                outputs=str(problem.get("outputs") or ""),
                constraints=str(problem.get("constraints") or ""),
            )
            if approved:
                status_map[pid_str] = "approved"
                _set_problem_status(
                    supabase=supabase,
                    problem_id=pid,
                    status="approved",
                    reporter_id=user_id,
                    reason=f"Auto-corrected from rejected: {reason}",
                )

        submissions = []
        for problem in problems:
            pid = problem.get("id")
            pid_str = str(pid)
            enriched = dict(problem)
            enriched["moderation_status"] = status_map.get(pid_str, "pending")
            if not enriched.get("created_at"):
                enriched["created_at"] = created_at_map.get(pid_str)
            submissions.append(enriched)

        submissions.sort(
            key=lambda item: str(item.get("created_at") or ""),
            reverse=True,
        )
        return {"submissions": submissions}
    except Exception as exc:
        return {"submissions": [], "error": str(exc)}


@router.post("/community/update-problem", response_model=UpdateCommunityProblemResponse)
async def update_community_problem(req: UpdateCommunityProblemRequest):
    try:
        from services.supabase_client import get_supabase
        supabase = get_supabase()

        problem_id: Union[str, int] = req.problem_id
        try:
            problem_id = int(req.problem_id)
        except Exception:
            problem_id = req.problem_id

        supabase.table("community_problems").update(
            {
                "title": req.title.strip(),
                "description": req.description.strip(),
                "difficulty": req.difficulty.strip().lower(),
                "board": req.board.strip(),
            }
        ).eq("id", problem_id).execute()

        return UpdateCommunityProblemResponse(ok=True)
    except Exception as exc:
        return UpdateCommunityProblemResponse(ok=False, error=str(exc))


@router.post("/community/delete-problem", response_model=DeleteCommunityProblemResponse)
async def delete_community_problem(req: DeleteCommunityProblemRequest):
    try:
        from services.supabase_client import get_supabase
        supabase = get_supabase()

        problem_id: Union[str, int] = req.problem_id
        try:
            problem_id = int(req.problem_id)
        except Exception:
            problem_id = req.problem_id

        # Best-effort cleanup for both moderation_queue schemas.
        try:
            supabase.table("moderation_queue").delete().eq("problem_id", problem_id).execute()
        except Exception:
            pass
        try:
            supabase.table("moderation_queue").delete().eq("content_id", problem_id).execute()
        except Exception:
            pass

        supabase.table("community_problems").delete().eq("id", problem_id).execute()
        return DeleteCommunityProblemResponse(ok=True)
    except Exception as exc:
        return DeleteCommunityProblemResponse(ok=False, error=str(exc))


class AISolutionRequest(BaseModel):
    problem_id: str
    title: str
    description: str
    board: str = "CIE IGCSE"
    inputs: str = ""
    outputs: str = ""
    constraints: str = ""


class AISolutionResponse(BaseModel):
    solution: str
    cached: bool = False
    error: Optional[str] = None


def _strip_fences(text: str) -> str:
    text = text.strip().removeprefix("```").removesuffix("```").strip()
    for lang in ("pseudocode", "pascal", "text", "plaintext"):
        if text.lower().startswith(lang):
            text = text[len(lang):].strip()
    return text


async def _review_solution_with_ai(
    *,
    board: str,
    problem_title: str,
    problem_description: str,
    pseudocode: str,
) -> tuple[bool, str]:
    if not settings.GEMINI_API_KEY:
        return True, "AI key not configured. Auto-approved."

    prompt = f"""You are a strict moderator for a student pseudocode community.
Review this submitted pseudocode solution for the given problem.

Board: {board}
Problem title: {problem_title}
Problem description: {problem_description}

Submitted pseudocode solution:
{pseudocode}

Approve ONLY if:
- It is relevant to the problem
- It is safe and non-abusive
- It does not contain hate, harassment, sexual content, self-harm encouragement, violence threats, or illegal instructions
- It is not obvious spam or nonsense

Return ONLY one JSON object in this exact format:
{{"approved": true/false, "reason": "short reason"}}"""

    try:
        text = await _ask_gemini(prompt, max_tokens=180, timeout=15.0)
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

        return approved, reason
    except Exception:
        return False, "AI review failed. Please retry."


def _insert_solution_rejection_event(
    *,
    supabase: Any,
    problem_id: Union[str, int],
    author_id: Optional[str],
    pseudocode: str,
    review_reason: str,
) -> None:
    moderation_payloads = [
        {
            "content_type": "solution",
            "content_id": problem_id,
            "reporter_id": author_id,
            "reason": f"AI rejected: {review_reason}\n\n---\n{pseudocode}",
            "status": "rejected",
        },
        {
            "content_type": "solution",
            "content_id": problem_id,
            "reason": f"AI rejected: {review_reason}\n\n---\n{pseudocode}",
            "status": "rejected",
        },
    ]
    for payload in moderation_payloads:
        try:
            supabase.table("moderation_queue").insert(payload).execute()
            break
        except Exception:
            continue


def _delete_solution_record(
    *,
    supabase: Any,
    solution_id: Union[str, int],
    author_id: Optional[str],
) -> None:
    query = supabase.table("community_solutions").delete().eq("id", solution_id)
    if author_id:
        query = query.eq("author_id", author_id)
    query.execute()


def _delete_queue_solution_record(
    *,
    supabase: Any,
    queue_id: Union[str, int],
    author_id: Optional[str],
) -> None:
    query = supabase.table("moderation_queue").delete().eq("id", queue_id)
    if author_id:
        query = query.eq("reporter_id", author_id)
    query.execute()


def _load_problem_context(
    *,
    supabase: Any,
    parsed_problem_id: Union[str, int],
) -> tuple[str, str, str]:
    problem_title = ""
    problem_description = ""
    problem_board = "CIE IGCSE"
    try:
        problem_lookup = (
            supabase.table("community_problems")
            .select("title,description,board")
            .eq("id", parsed_problem_id)
            .maybe_single()
            .execute()
        )
        problem_row = problem_lookup.data or {}
        problem_title = str(problem_row.get("title") or "")
        problem_description = str(problem_row.get("description") or "")
        raw_board = str(problem_row.get("board") or "CIE IGCSE")
        problem_board = BOARD_LABELS.get(raw_board.strip().lower(), raw_board)
    except Exception:
        pass
    return problem_title, problem_description, problem_board


@router.post("/community/ai-solution", response_model=AISolutionResponse)
async def ai_solution(req: AISolutionRequest):
    from services.supabase_client import get_supabase
    supabase = get_supabase()
    loop = asyncio.get_event_loop()

    # Check cache — maybe_single() returns None data on miss instead of raising
    try:
        cached = await loop.run_in_executor(
            None,
            lambda: supabase.table("community_ai_solutions")
                .select("solution")
                .eq("problem_id", req.problem_id)
                .maybe_single()
                .execute()
        )
        if cached.data and cached.data.get("solution"):
            return AISolutionResponse(solution=cached.data["solution"], cached=True)
    except Exception:
        pass  # Table may not exist yet — fall through

    # Generate
    board = BOARD_LABELS.get(req.board.strip().lower(), req.board)

    extras = []
    if req.inputs.strip():
        extras.append(f"Inputs: {req.inputs.strip()}")
    if req.outputs.strip():
        extras.append(f"Expected outputs: {req.outputs.strip()}")
    if req.constraints.strip():
        extras.append(f"Constraints: {req.constraints.strip()}")
    extras_block = ("\n" + "\n".join(extras)) if extras else ""

    prompt = f"""You are an expert {board} Computer Science teacher writing a model-answer pseudocode solution.

PROBLEM: {req.title.strip()}
{req.description.strip()}{extras_block}

Write a complete, correct pseudocode solution using proper {board} syntax and conventions.

RULES:
- Add a short comment (using //) on every meaningful line explaining what it does in plain English.
- Use correct {board} keywords exactly (INPUT, OUTPUT, IF/THEN/ELSE/ENDIF, FOR/TO/NEXT, WHILE/DO/ENDWHILE, DECLARE, etc.).
- Output pseudocode only — no markdown fences, no preamble, no explanation outside the pseudocode.
- Keep it clean, readable, and idiomatic for a {board} exam.
"""

    try:
        solution = _strip_fences(await _ask_gemini(prompt, max_tokens=800, timeout=15.0))

        # Persist to cache in background — don't block the response
        async def _save():
            try:
                await loop.run_in_executor(
                    None,
                    lambda: supabase.table("community_ai_solutions").upsert({
                        "problem_id": req.problem_id,
                        "solution": solution,
                    }).execute()
                )
            except Exception:
                pass
        asyncio.ensure_future(_save())

        return AISolutionResponse(solution=solution, cached=False)
    except Exception as exc:
        return AISolutionResponse(solution="", error=str(exc))


class SubmitCommunitySolutionRequest(BaseModel):
    problem_id: str
    pseudocode: str
    author_id: Optional[str] = None
    is_ai_generated: bool = False


class SubmitCommunitySolutionResponse(BaseModel):
    ok: bool
    solution_id: Optional[str] = None
    error: Optional[str] = None


@router.post("/community/submit-solution", response_model=SubmitCommunitySolutionResponse)
async def submit_community_solution(req: SubmitCommunitySolutionRequest):
    try:
        from services.supabase_client import get_supabase

        supabase = get_supabase()

        parsed_problem_id: Union[str, int] = req.problem_id
        try:
            parsed_problem_id = int(req.problem_id)
        except Exception:
            parsed_problem_id = req.problem_id

        pseudocode = req.pseudocode.strip()
        if not pseudocode:
            return SubmitCommunitySolutionResponse(
                ok=False,
                error="Solution cannot be empty.",
            )

        problem_title, problem_description, problem_board = _load_problem_context(
            supabase=supabase,
            parsed_problem_id=parsed_problem_id,
        )

        approved, review_reason = await _review_solution_with_ai(
            board=problem_board,
            problem_title=problem_title or "Community Problem",
            problem_description=problem_description or "",
            pseudocode=pseudocode,
        )

        if not approved:
            try:
                _insert_solution_rejection_event(
                    supabase=supabase,
                    problem_id=parsed_problem_id,
                    author_id=req.author_id,
                    pseudocode=pseudocode,
                    review_reason=review_reason,
                )
            except Exception:
                pass

            return SubmitCommunitySolutionResponse(
                ok=False,
                error=f"AI rejected solution: {review_reason}",
            )

        payloads = [
            {
                "problem_id": parsed_problem_id,
                "pseudocode": pseudocode,
                "author_id": req.author_id,
                "is_ai_generated": req.is_ai_generated,
            },
            {
                "problem_id": parsed_problem_id,
                "pseudocode": pseudocode,
                "author_id": req.author_id,
            },
            {
                "problem_id": parsed_problem_id,
                "pseudocode": pseudocode,
            },
        ]

        inserted_data = []
        last_error: Optional[str] = None
        for payload in payloads:
            try:
                response = supabase.table("community_solutions").insert(payload).execute()
                inserted_data = getattr(response, "data", None) or []
                if inserted_data:
                    break
            except Exception as inner_exc:
                last_error = str(inner_exc)

        if not inserted_data:
            # Fallback for deployments where community_solutions table does not exist.
            last_error_text = (last_error or "").lower()
            missing_solutions_table = (
                "community_solutions" in last_error_text
                and ("schema cache" in last_error_text or "could not find the table" in last_error_text)
            )

            if missing_solutions_table:
                try:
                    queue_payloads = [
                        {
                            "content_type": "solution",
                            "content_id": parsed_problem_id,
                            "reporter_id": req.author_id,
                            "reason": pseudocode,
                            "status": "approved",
                        },
                        {
                            "content_type": "solution",
                            "content_id": parsed_problem_id,
                            "reporter_id": req.author_id,
                            "reason": pseudocode,
                        },
                        {
                            "content_type": "solution",
                            "content_id": parsed_problem_id,
                            "reason": pseudocode,
                        },
                    ]
                    queue_data = []
                    for payload in queue_payloads:
                        try:
                            queue_response = (
                                supabase.table("moderation_queue")
                                .insert(payload)
                                .execute()
                            )
                            queue_data = getattr(queue_response, "data", None) or []
                            if queue_data:
                                break
                        except Exception:
                            continue

                    return SubmitCommunitySolutionResponse(
                        ok=bool(queue_data),
                        solution_id=(
                            f"mq:{queue_data[0].get('id')}"
                            if queue_data and queue_data[0].get("id") is not None
                            else None
                        ),
                        error=None if queue_data else "Fallback insert into moderation_queue failed.",
                    )
                except Exception as cache_exc:
                    return SubmitCommunitySolutionResponse(
                        ok=False,
                        error=f"{last_error or 'community_solutions insert failed'} | fallback failed: {cache_exc}",
                    )

            return SubmitCommunitySolutionResponse(
                ok=False,
                error=last_error or "Insert failed for community_solutions.",
            )

        return SubmitCommunitySolutionResponse(
            ok=True,
            solution_id=str(inserted_data[0].get("id"))
            if inserted_data[0].get("id") is not None
            else None,
        )
    except Exception as exc:
        return SubmitCommunitySolutionResponse(ok=False, error=str(exc))


class UpdateCommunitySolutionRequest(BaseModel):
    solution_id: str
    pseudocode: str
    author_id: Optional[str] = None


class UpdateCommunitySolutionResponse(BaseModel):
    ok: bool
    error: Optional[str] = None


@router.post("/community/update-solution", response_model=UpdateCommunitySolutionResponse)
async def update_community_solution(req: UpdateCommunitySolutionRequest):
    try:
        from services.supabase_client import get_supabase

        supabase = get_supabase()
        pseudocode = req.pseudocode.strip()
        if not pseudocode:
            return UpdateCommunitySolutionResponse(ok=False, error="Solution cannot be empty.")

        if req.solution_id.startswith("mq:"):
            mq_id_value = req.solution_id.split("mq:", 1)[1]
            mq_id: Union[str, int] = mq_id_value
            try:
                mq_id = int(mq_id_value)
            except Exception:
                mq_id = mq_id_value

            problem_id = None
            try:
                mq_lookup = (
                    supabase.table("moderation_queue")
                    .select("content_id,reporter_id")
                    .eq("id", mq_id)
                    .maybe_single()
                    .execute()
                )
                mq_row = mq_lookup.data or {}
                if req.author_id and str(mq_row.get("reporter_id") or "") != str(req.author_id):
                    return UpdateCommunitySolutionResponse(ok=False, error="Solution not found.")
                problem_id = mq_row.get("content_id")
            except Exception:
                problem_id = None

            parsed_problem_id: Union[str, int] = "unknown"
            if problem_id is not None:
                parsed_problem_id = problem_id
                try:
                    parsed_problem_id = int(str(problem_id))
                except Exception:
                    parsed_problem_id = str(problem_id)

            problem_title, problem_description, problem_board = _load_problem_context(
                supabase=supabase,
                parsed_problem_id=parsed_problem_id,
            )

            approved, review_reason = await _review_solution_with_ai(
                board=problem_board,
                problem_title=problem_title or "Community Problem",
                problem_description=problem_description or "",
                pseudocode=pseudocode,
            )

            if not approved:
                try:
                    _insert_solution_rejection_event(
                        supabase=supabase,
                        problem_id=parsed_problem_id,
                        author_id=req.author_id,
                        pseudocode=pseudocode,
                        review_reason=review_reason,
                    )
                except Exception:
                    pass
                try:
                    _delete_queue_solution_record(
                        supabase=supabase,
                        queue_id=mq_id,
                        author_id=req.author_id,
                    )
                except Exception:
                    pass
                return UpdateCommunitySolutionResponse(
                    ok=False,
                    error=f"AI removed solution: {review_reason}",
                )

            query = supabase.table("moderation_queue").update(
                {
                    "reason": pseudocode,
                }
            ).eq("id", mq_id)
            if req.author_id:
                query = query.eq("reporter_id", req.author_id)
            query.execute()
            return UpdateCommunitySolutionResponse(ok=True)

        solution_id: Union[str, int] = req.solution_id
        try:
            solution_id = int(req.solution_id)
        except Exception:
            solution_id = req.solution_id

        solution_query = (
            supabase.table("community_solutions")
            .select("problem_id,author_id")
            .eq("id", solution_id)
        )
        if req.author_id:
            solution_query = solution_query.eq("author_id", req.author_id)
        solution_lookup = solution_query.maybe_single().execute()
        solution_row = solution_lookup.data or {}
        if not solution_row:
            return UpdateCommunitySolutionResponse(ok=False, error="Solution not found.")

        parsed_problem_id: Union[str, int] = solution_row.get("problem_id")
        if parsed_problem_id is None:
            parsed_problem_id = "unknown"
        else:
            try:
                parsed_problem_id = int(str(parsed_problem_id))
            except Exception:
                parsed_problem_id = str(parsed_problem_id)

        problem_title, problem_description, problem_board = _load_problem_context(
            supabase=supabase,
            parsed_problem_id=parsed_problem_id,
        )

        approved, review_reason = await _review_solution_with_ai(
            board=problem_board,
            problem_title=problem_title or "Community Problem",
            problem_description=problem_description or "",
            pseudocode=pseudocode,
        )

        if not approved:
            try:
                _insert_solution_rejection_event(
                    supabase=supabase,
                    problem_id=parsed_problem_id,
                    author_id=req.author_id or solution_row.get("author_id"),
                    pseudocode=pseudocode,
                    review_reason=review_reason,
                )
            except Exception:
                pass
            try:
                _delete_solution_record(
                    supabase=supabase,
                    solution_id=solution_id,
                    author_id=req.author_id,
                )
            except Exception:
                pass
            return UpdateCommunitySolutionResponse(
                ok=False,
                error=f"AI removed solution: {review_reason}",
            )

        query = supabase.table("community_solutions").update(
            {
                "pseudocode": pseudocode,
            }
        ).eq("id", solution_id)

        if req.author_id:
            query = query.eq("author_id", req.author_id)

        query.execute()
        return UpdateCommunitySolutionResponse(ok=True)
    except Exception as exc:
        return UpdateCommunitySolutionResponse(ok=False, error=str(exc))


class DeleteCommunitySolutionRequest(BaseModel):
    solution_id: str
    author_id: Optional[str] = None


class DeleteCommunitySolutionResponse(BaseModel):
    ok: bool
    error: Optional[str] = None


@router.post("/community/delete-solution", response_model=DeleteCommunitySolutionResponse)
async def delete_community_solution(req: DeleteCommunitySolutionRequest):
    try:
        from services.supabase_client import get_supabase

        supabase = get_supabase()
        if req.solution_id.startswith("mq:"):
            mq_id_value = req.solution_id.split("mq:", 1)[1]
            mq_id: Union[str, int] = mq_id_value
            try:
                mq_id = int(mq_id_value)
            except Exception:
                mq_id = mq_id_value

            query = supabase.table("moderation_queue").delete().eq("id", mq_id)
            if req.author_id:
                query = query.eq("reporter_id", req.author_id)

            query.execute()
            return DeleteCommunitySolutionResponse(ok=True)

        solution_id: Union[str, int] = req.solution_id
        try:
            solution_id = int(req.solution_id)
        except Exception:
            solution_id = req.solution_id

        query = supabase.table("community_solutions").delete().eq("id", solution_id)
        if req.author_id:
            query = query.eq("author_id", req.author_id)

        query.execute()
        return DeleteCommunitySolutionResponse(ok=True)
    except Exception as exc:
        return DeleteCommunitySolutionResponse(ok=False, error=str(exc))
