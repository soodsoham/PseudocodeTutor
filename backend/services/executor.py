import httpx

WANDBOX_URL = "https://wandbox.org/api/compile.json"

LANGUAGE_MAP = {
    "python": "cpython-3.12.7",
    "java": "openjdk-jdk-21+35",
    "cpp": "gcc-13.2.0",
}


async def execute(language: str, code: str, stdin: str, timeout: int) -> dict:
    if language in ("sql", "html", "vb"):
        msgs = {
            "sql": "SQL execution is not supported.",
            "html": "HTML cannot be executed as a program.",
            "vb": "Visual Basic execution is not supported.",
        }
        return {"stdout": "", "stderr": msgs[language], "code": 1}

    compiler = LANGUAGE_MAP.get(language)
    if not compiler:
        return {"stdout": "", "stderr": f"{language} is not supported.", "code": 1}

    # For Java: strip 'public' from class declaration so Wandbox filename doesn't conflict
    if language == "java":
        code = code.replace("public class ", "class ")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                WANDBOX_URL,
                json={
                    "compiler": compiler,
                    "code": code,
                    "stdin": stdin,
                },
                timeout=timeout + 10
            )
            result = response.json()
            print("Wandbox raw response:", result)
            stdout = result.get("program_output", "")
            stderr = result.get("compiler_error", "") or result.get("program_error", "")
            status = int(result.get("status", "1"))
            return {
                "stdout": stdout,
                "stderr": stderr,
                "code": status
            }
    except Exception as e:
        return {"stdout": "", "stderr": str(e), "code": 1}
