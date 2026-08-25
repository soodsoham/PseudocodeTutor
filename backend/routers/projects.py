from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel
from typing import Optional, Any, Dict, List, Tuple
import asyncio
import json
from datetime import datetime, timezone
from uuid import uuid4
from urllib.parse import unquote

router = APIRouter()

GUEST_PROJECTS_COOKIE = "guest_projects"
GUEST_PROJECTS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30
MAX_GUEST_PROJECTS = 20
_PROJECTS_HAS_PROBLEM_COLUMN: Optional[bool] = None
_PROJECTS_PROBLEM_FIELD: Optional[str] = None


class SaveProjectRequest(BaseModel):
    user_id: Optional[str] = None
    title: str = "Untitled"
    problem: str = ""
    pseudocode: str = ""
    board: str = "CIE IGCSE"
    language: str = "Python"


class SaveProjectResponse(BaseModel):
    ok: bool
    project_id: Optional[str] = None
    error: Optional[str] = None


class UpdateProjectRequest(BaseModel):
    project_id: str
    user_id: Optional[str] = None
    title: Optional[str] = None
    problem: Optional[str] = None
    pseudocode: Optional[str] = None
    board: Optional[str] = None
    language: Optional[str] = None


class UpdateProjectResponse(BaseModel):
    ok: bool
    error: Optional[str] = None


class DeleteProjectResponse(BaseModel):
    ok: bool
    error: Optional[str] = None


def _get_supabase():
    from services.supabase_client import get_supabase
    return get_supabase()


def _projects_has_problem_column(supabase: Any) -> bool:
    global _PROJECTS_HAS_PROBLEM_COLUMN
    if _PROJECTS_HAS_PROBLEM_COLUMN is not None:
        return _PROJECTS_HAS_PROBLEM_COLUMN
    try:
        supabase.table("projects").select("problem").limit(1).execute()
        _PROJECTS_HAS_PROBLEM_COLUMN = True
    except Exception as exc:
        message = str(exc).lower()
        if "does not exist" in message or "could not find the 'problem' column" in message:
            _PROJECTS_HAS_PROBLEM_COLUMN = False
        else:
            _PROJECTS_HAS_PROBLEM_COLUMN = True
    return _PROJECTS_HAS_PROBLEM_COLUMN


def _projects_problem_field(supabase: Any) -> Optional[str]:
    global _PROJECTS_PROBLEM_FIELD
    if _PROJECTS_PROBLEM_FIELD is not None:
        return _PROJECTS_PROBLEM_FIELD

    if _projects_has_problem_column(supabase):
        _PROJECTS_PROBLEM_FIELD = "problem"
        return _PROJECTS_PROBLEM_FIELD

    try:
        supabase.table("projects").select("problem_description").limit(1).execute()
        _PROJECTS_PROBLEM_FIELD = "problem_description"
        return _PROJECTS_PROBLEM_FIELD
    except Exception:
        _PROJECTS_PROBLEM_FIELD = None
        return None


def _ensure_profile_exists(supabase: Any, user_id: str) -> bool:
    try:
        existing = (
            supabase.table("profiles")
            .select("id")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        if existing.data:
            return True
    except Exception:
        pass

    payloads = [
        {"id": user_id},
        {"id": user_id, "updated_at": _now_iso()},
    ]
    for payload in payloads:
        try:
            supabase.table("profiles").insert(payload).execute()
            return True
        except Exception:
            continue
    return False


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _is_guest_user(user_id: Optional[str]) -> bool:
    if user_id is None:
        return True
    normalized = user_id.strip().lower()
    return (
        normalized == ""
        or normalized in {"guest", "guest-user", "guest_account", "undefined", "null", "none", "nan"}
        or normalized.startswith("guest_")
    )


def _normalize_user_id(user_id: str) -> str:
    return user_id.strip().lower()


def _build_user_id_candidates(effective_user_id: Optional[str], explicit_user_id: Optional[str]) -> List[str]:
    candidates: List[str] = []
    seen = set()

    def add(value: Optional[str]) -> None:
        if not value:
            return
        normalized = value.strip()
        if not normalized:
            return
        key = normalized.lower()
        if key in seen:
            return
        seen.add(key)
        candidates.append(normalized)

    if effective_user_id:
        add(effective_user_id)
    if explicit_user_id and not _is_guest_user(explicit_user_id):
        add(_normalize_user_id(explicit_user_id))
        add(explicit_user_id)

    return candidates


def _extract_bearer_token(request: Request) -> Optional[str]:
    auth_header = request.headers.get("authorization", "").strip()
    if not auth_header:
        return None
    lower = auth_header.lower()
    if not lower.startswith("bearer "):
        return None
    token = auth_header[7:].strip()
    return token or None


def _extract_supabase_token_from_cookies(request: Request) -> Optional[str]:
    for key, raw_value in request.cookies.items():
        if not key.startswith("sb-") or not key.endswith("-auth-token"):
            continue

        # Supabase auth cookie can be JSON object or array depending on client version.
        try:
            decoded = unquote(raw_value)
            parsed = json.loads(decoded)
        except Exception:
            continue

        if isinstance(parsed, dict):
            token = parsed.get("access_token")
            if isinstance(token, str) and token.strip():
                return token.strip()
            current_session = parsed.get("currentSession")
            if isinstance(current_session, dict):
                token = current_session.get("access_token")
                if isinstance(token, str) and token.strip():
                    return token.strip()
        elif isinstance(parsed, list):
            for item in parsed:
                if isinstance(item, dict):
                    token = item.get("access_token")
                    if isinstance(token, str) and token.strip():
                        return token.strip()
    return None


def _resolve_effective_user(request: Request, explicit_user_id: Optional[str]) -> Tuple[Optional[str], bool]:
    candidate_from_header = request.headers.get("x-user-id")
    if candidate_from_header and not _is_guest_user(candidate_from_header):
        explicit_user_id = candidate_from_header
    elif candidate_from_header and _is_guest_user(candidate_from_header):
        explicit_user_id = candidate_from_header

    if explicit_user_id and _is_guest_user(explicit_user_id):
        return None, True

    token = _extract_bearer_token(request) or _extract_supabase_token_from_cookies(request)
    if token:
        try:
            supabase = _get_supabase()
            user_response = supabase.auth.get_user(jwt=token)
            user = getattr(user_response, "user", None)
            user_id = getattr(user, "id", None)
            if isinstance(user_id, str) and user_id.strip():
                return _normalize_user_id(user_id), False
        except Exception:
            # Fall through to explicit user id when token lookup fails.
            pass

    if explicit_user_id and not _is_guest_user(explicit_user_id):
        return _normalize_user_id(explicit_user_id), False
    if request.cookies.get(GUEST_PROJECTS_COOKIE):
        return None, True
    return None, False


def _normalize_guest_project(raw: Dict[str, Any]) -> Dict[str, Any]:
    now = _now_iso()
    return {
        "id": str(raw.get("id") or uuid4()),
        "title": str(raw.get("title") or "Untitled").strip() or "Untitled",
        "problem": str(raw.get("problem") or ""),
        "pseudocode": str(raw.get("pseudocode") or ""),
        "board": str(raw.get("board") or "CIE IGCSE"),
        "language": str(raw.get("language") or "Python"),
        "created_at": str(raw.get("created_at") or now),
        "updated_at": str(raw.get("updated_at") or now),
    }


def _read_guest_projects(request: Request) -> List[Dict[str, Any]]:
    raw = request.cookies.get(GUEST_PROJECTS_COOKIE)
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []

    normalized: List[Dict[str, Any]] = []
    for item in parsed[:MAX_GUEST_PROJECTS]:
        if isinstance(item, dict):
            normalized.append(_normalize_guest_project(item))
    normalized.sort(key=lambda p: str(p.get("updated_at") or ""), reverse=True)
    return normalized


def _write_guest_projects_cookie(response: Response, projects: List[Dict[str, Any]]) -> None:
    normalized = [_normalize_guest_project(project) for project in projects if isinstance(project, dict)]
    normalized.sort(key=lambda p: str(p.get("updated_at") or ""), reverse=True)
    trimmed = normalized[:MAX_GUEST_PROJECTS]
    response.set_cookie(
        key=GUEST_PROJECTS_COOKIE,
        value=json.dumps(trimmed, separators=(",", ":")),
        max_age=GUEST_PROJECTS_COOKIE_MAX_AGE,
        expires=GUEST_PROJECTS_COOKIE_MAX_AGE,
        path="/",
        samesite="lax",
        httponly=False,
    )


def _clear_guest_projects_cookie(response: Response) -> None:
    response.delete_cookie(key=GUEST_PROJECTS_COOKIE, path="/")


@router.post("/projects", response_model=SaveProjectResponse)
async def create_project(req: SaveProjectRequest, response: Response, request: Request):
    loop = asyncio.get_event_loop()
    try:
        effective_user_id, is_guest = _resolve_effective_user(request, req.user_id)
        user_id_candidates = _build_user_id_candidates(effective_user_id, req.user_id)
        if is_guest:
            now = _now_iso()
            project_id = str(uuid4())
            projects = _read_guest_projects(request)
            projects.insert(
                0,
                {
                    "id": project_id,
                    "title": req.title.strip() or "Untitled",
                    "problem": req.problem,
                    "pseudocode": req.pseudocode,
                    "board": req.board,
                    "language": req.language,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            _write_guest_projects_cookie(response, projects)
            return SaveProjectResponse(ok=True, project_id=project_id)
        if not user_id_candidates:
            return SaveProjectResponse(
                ok=False,
                error="Missing signed-in identity. Send Authorization token/user_id, or use guest user_id.",
            )

        owner_user_id = user_id_candidates[0]
        supabase = _get_supabase()
        problem_field = _projects_problem_field(supabase)
        payload: Dict[str, Any] = {
            "user_id": owner_user_id,
            "title": req.title.strip() or "Untitled",
            "pseudocode": req.pseudocode,
            "board": req.board,
            "language": req.language,
        }
        if problem_field:
            payload[problem_field] = req.problem
        try:
            result = await loop.run_in_executor(
                None,
                lambda: supabase.table("projects").insert(payload).execute()
            )
        except Exception as insert_exc:
            msg = str(insert_exc).lower()
            fk_profile_error = "projects_user_id_fkey" in msg or "profiles" in msg
            if fk_profile_error and _ensure_profile_exists(supabase, owner_user_id):
                result = await loop.run_in_executor(
                    None,
                    lambda: supabase.table("projects").insert(payload).execute()
                )
            else:
                raise
        data = result.data or []
        if not data:
            return SaveProjectResponse(ok=False, error="Insert failed")
        return SaveProjectResponse(ok=True, project_id=str(data[0]["id"]))
    except Exception as exc:
        return SaveProjectResponse(ok=False, error=str(exc))


@router.put("/projects/{project_id}", response_model=UpdateProjectResponse)
async def update_project(project_id: str, req: UpdateProjectRequest, response: Response, request: Request):
    loop = asyncio.get_event_loop()
    try:
        effective_user_id, is_guest = _resolve_effective_user(request, req.user_id)
        user_id_candidates = _build_user_id_candidates(effective_user_id, req.user_id)
        if is_guest:
            projects = _read_guest_projects(request)
            target = next((p for p in projects if str(p.get("id")) == str(project_id)), None)
            if not target:
                return UpdateProjectResponse(ok=False, error="Not found")

            if req.title is not None:
                target["title"] = req.title.strip() or "Untitled"
            if req.problem is not None:
                target["problem"] = req.problem
            if req.pseudocode is not None:
                target["pseudocode"] = req.pseudocode
            if req.board is not None:
                target["board"] = req.board
            if req.language is not None:
                target["language"] = req.language
            target["updated_at"] = _now_iso()

            _write_guest_projects_cookie(response, projects)
            return UpdateProjectResponse(ok=True)
        if not user_id_candidates:
            return UpdateProjectResponse(
                ok=False,
                error="Missing signed-in identity. Send Authorization token/user_id, or use guest user_id.",
            )

        supabase = _get_supabase()
        problem_field = _projects_problem_field(supabase)
        updates = {}
        if req.title is not None:
            updates["title"] = req.title.strip() or "Untitled"
        if req.problem is not None:
            if problem_field:
                updates[problem_field] = req.problem
        if req.pseudocode is not None:
            updates["pseudocode"] = req.pseudocode
        if req.board is not None:
            updates["board"] = req.board
        if req.language is not None:
            updates["language"] = req.language
        updates["updated_at"] = _now_iso()

        if not updates:
            return UpdateProjectResponse(ok=True)

        await loop.run_in_executor(
            None,
            lambda: supabase.table("projects")
                .update(updates)
                .eq("id", project_id)
                .in_("user_id", user_id_candidates)
                .execute()
        )
        return UpdateProjectResponse(ok=True)
    except Exception as exc:
        return UpdateProjectResponse(ok=False, error=str(exc))


@router.get("/projects")
async def list_projects(request: Request, user_id: Optional[str] = Query(None)):
    loop = asyncio.get_event_loop()
    try:
        effective_user_id, is_guest = _resolve_effective_user(request, user_id)
        user_id_candidates = _build_user_id_candidates(effective_user_id, user_id)
        if is_guest:
            return {"projects": _read_guest_projects(request)}
        if not user_id_candidates:
            return {
                "projects": [],
                "error": "Missing signed-in identity. Send Authorization token/user_id, or use guest user_id.",
            }

        supabase = _get_supabase()
        problem_field = _projects_problem_field(supabase)
        select_fields = "id, title, pseudocode, board, language, created_at, updated_at"
        if problem_field:
            select_fields = f"id, title, {problem_field}, pseudocode, board, language, created_at, updated_at"
        result = await loop.run_in_executor(
            None,
            lambda: supabase.table("projects")
                .select(select_fields)
                .in_("user_id", user_id_candidates)
                .order("updated_at", desc=True)
                .execute()
        )
        rows = result.data or []
        if problem_field and problem_field != "problem":
            rows = [
                {**{k: v for k, v in row.items() if k != problem_field}, "problem": str(row.get(problem_field) or "")}
                for row in rows
            ]
        elif not problem_field:
            rows = [{**row, "problem": ""} for row in rows]
        return {"projects": rows}
    except Exception as exc:
        return {"projects": [], "error": str(exc)}


@router.get("/projects/whoami")
async def projects_whoami(request: Request, user_id: Optional[str] = Query(None)):
    effective_user_id, is_guest = _resolve_effective_user(request, user_id)
    return {
        "is_guest": is_guest,
        "effective_user_id": effective_user_id,
        "user_id_candidates": _build_user_id_candidates(effective_user_id, user_id),
        "has_auth_header": bool(_extract_bearer_token(request)),
    }


@router.get("/projects/{project_id}")
async def get_project(project_id: str, request: Request, user_id: Optional[str] = Query(None)):
    loop = asyncio.get_event_loop()
    try:
        effective_user_id, is_guest = _resolve_effective_user(request, user_id)
        user_id_candidates = _build_user_id_candidates(effective_user_id, user_id)
        if is_guest:
            project = next(
                (p for p in _read_guest_projects(request) if str(p.get("id")) == str(project_id)),
                None,
            )
            if not project:
                return {"project": None, "error": "Not found"}
            return {"project": project}
        if not user_id_candidates:
            return {
                "project": None,
                "error": "Missing signed-in identity. Send Authorization token/user_id, or use guest user_id.",
            }

        supabase = _get_supabase()
        problem_field = _projects_problem_field(supabase)
        select_fields = "id, title, pseudocode, board, language, created_at, updated_at"
        if problem_field:
            select_fields = f"id, title, {problem_field}, pseudocode, board, language, created_at, updated_at"
        result = await loop.run_in_executor(
            None,
            lambda: supabase.table("projects")
                .select(select_fields)
                .eq("id", project_id)
                .in_("user_id", user_id_candidates)
                .maybe_single()
                .execute()
        )
        if not result.data:
            return {"project": None, "error": "Not found"}
        row = result.data
        if problem_field and problem_field != "problem":
            row = {**{k: v for k, v in row.items() if k != problem_field}, "problem": str(row.get(problem_field) or "")}
        elif not problem_field:
            row = {**row, "problem": ""}
        return {"project": row}
    except Exception as exc:
        return {"project": None, "error": str(exc)}


@router.delete("/projects/{project_id}", response_model=DeleteProjectResponse)
async def delete_project(project_id: str, response: Response, request: Request, user_id: Optional[str] = Query(None)):
    loop = asyncio.get_event_loop()
    try:
        effective_user_id, is_guest = _resolve_effective_user(request, user_id)
        user_id_candidates = _build_user_id_candidates(effective_user_id, user_id)
        if is_guest:
            projects = _read_guest_projects(request)
            filtered = [p for p in projects if str(p.get("id")) != str(project_id)]
            if filtered:
                _write_guest_projects_cookie(response, filtered)
            else:
                _clear_guest_projects_cookie(response)
            return DeleteProjectResponse(ok=True)
        if not user_id_candidates:
            return DeleteProjectResponse(
                ok=False,
                error="Missing signed-in identity. Send Authorization token/user_id, or use guest user_id.",
            )

        supabase = _get_supabase()
        await loop.run_in_executor(
            None,
            lambda: supabase.table("projects")
                .delete()
                .eq("id", project_id)
                .in_("user_id", user_id_candidates)
                .execute()
        )
        return DeleteProjectResponse(ok=True)
    except Exception as exc:
        return DeleteProjectResponse(ok=False, error=str(exc))
