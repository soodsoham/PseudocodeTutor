from fastapi import APIRouter
from models.execute import ExecuteRequest, ExecuteResponse
from services import executor

router = APIRouter()

ALLOWED_LANGUAGES = {"python", "java", "cpp", "vb", "sql"}


@router.post("/execute", response_model=ExecuteResponse)
async def execute_code(req: ExecuteRequest):
    if req.language not in ALLOWED_LANGUAGES:
        return ExecuteResponse(stdout="", stderr="Unsupported language.", exit_code=1)

    try:
        result = await executor.execute(
            language=req.language,
            code=req.code,
            stdin=req.stdin,
            timeout=5
        )
        return ExecuteResponse(
            stdout=result["stdout"],
            stderr=result["stderr"],
            exit_code=result["code"]
        )
    except Exception as e:
        return ExecuteResponse(stdout="", stderr=str(e), exit_code=1)
