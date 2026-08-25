from pydantic import BaseModel


class ExecuteRequest(BaseModel):
    language: str     # 'python', 'java', 'cpp', 'vb', 'sql'
    code: str
    stdin: str = ""


class ExecuteResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
