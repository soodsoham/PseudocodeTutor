from fastapi import APIRouter
from models.moderate import ModerateRequest, ModerateResponse

router = APIRouter()


@router.post("/moderate", response_model=ModerateResponse)
async def moderate_content(req: ModerateRequest):
    try:
        from services.supabase_client import get_supabase
        supabase = get_supabase()

        # Archive content immediately
        table = "community_problems" if req.content_type == "problem" else "past_papers"
        supabase.table(table).update({"status": "archived"}).eq("id", req.content_id).execute()

        # Insert into moderation queue
        supabase.table("moderation_queue").insert({
            "content_type": req.content_type,
            "content_id": req.content_id,
            "reporter_id": req.reporter_id,
            "reason": req.reason,
            "status": "pending"
        }).execute()

    except Exception:
        # Never block the reporter — always return success
        pass

    return ModerateResponse(success=True)
