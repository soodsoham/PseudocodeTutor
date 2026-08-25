import re
import httpx
from config import settings

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{settings.GEMINI_MODEL}:generateContent"
)


async def _ask_gemini(prompt: str, max_tokens: int = 2000, timeout: float = 15.0) -> str:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{GEMINI_URL}?key={settings.GEMINI_API_KEY}",
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "maxOutputTokens": max_tokens,
                    "temperature": 0.7
                }
            },
            timeout=timeout
        )
        data = response.json()
        if "error" in data:
            raise RuntimeError(data["error"].get("message", "Gemini error"))
        parts = data["candidates"][0]["content"]["parts"]
        text_parts = [p["text"] for p in parts if not p.get("thought") and p.get("text")]
        return " ".join(text_parts).strip()


def _extract_comments(pseudocode: str) -> tuple:
    """Pull out comment lines as questions or fix requests.

    Returns (questions, fix_requests) where fix_requests are (comment, line_context) tuples.
    """
    questions = []
    fix_requests = []
    for line in pseudocode.splitlines():
        match = re.search(r'(?://|#|--)\s*(.+)', line)
        if match:
            comment = match.group(1).strip()
            code_part = line[:match.start()].strip()
            if re.search(
                r'\b(fix|correct|solution|answer|show me|give me|what should|how should|fix this|correct this)\b',
                comment, re.IGNORECASE
            ):
                fix_requests.append((comment, code_part if code_part else line.strip()))
            elif "?" in comment or re.match(
                r"^(why|how|what|when|where|which|who|can|should|do|does|is|are|explain)\b",
                comment, re.IGNORECASE
            ):
                questions.append(comment)
    return questions, fix_requests


async def get_hint(
    problem: str,
    pseudocode: str,
    attempt_count: int,
    board: str,
    language: str
) -> dict:
    if not problem or not problem.strip():
        return {
            "hint": "Please type a problem in first before asking for a hint.",
            "suggest_trace": False,
            "ideal_solution": None,
            "is_correct": False,
        }

    if pseudocode.strip() and await _is_correct(problem, pseudocode, board):
        return {
            "hint": "Your solution looks correct! The logic matches what the problem is asking for.",
            "suggest_trace": False,
            "ideal_solution": None,
            "is_correct": True,
        }

    if attempt_count >= 5:
        ideal = await _generate_ideal_solution(problem, board)
        return {
            "hint": None,
            "suggest_trace": True,
            "ideal_solution": ideal,
            "is_correct": False,
        }

    questions, fix_requests = _extract_comments(pseudocode)
    hint = await _generate_hint(problem, pseudocode, attempt_count, board, questions, fix_requests)
    return {
        "hint": hint,
        "suggest_trace": False,
        "ideal_solution": None,
        "is_correct": False,
    }


async def _is_correct(problem: str, pseudocode: str, board: str) -> bool:
    prompt = f"""You are a {board} Computer Science examiner.

PROBLEM:
{problem.strip()}

STUDENT'S PSEUDOCODE:
{pseudocode.strip()}

Judge whether this pseudocode is functionally correct — meaning: if it were executed, would it produce the right outputs for the right inputs, matching what the problem requires?

Be lenient about stylistic variations (e.g. INPUT name AS STRING vs INPUT name, minor whitespace, ELSE on the same line as THEN, unquoted identifiers used as string literals). Focus only on whether the logic and intended outputs are correct.

Fail only if the logic is genuinely wrong, a required output is missing, an extra output is produced that the problem did not ask for, or a variable is used before it could possibly have a value assigned to it.

Reply with exactly one word: YES or NO.
"""
    try:
        result = await _ask_gemini(prompt, max_tokens=500, timeout=10.0)
        first_word = result.strip().split()[0].upper() if result.strip() else "NO"
        return first_word == "YES"
    except Exception:
        return False


async def _generate_hint(
    problem: str,
    pseudocode: str,
    attempt_count: int,
    board: str,
    questions: list,
    fix_requests: list = None
) -> str:
    has_pseudocode = bool(pseudocode.strip())
    fix_requests = fix_requests or []

    questions_section = ""
    if questions:
        formatted = "\n".join(f'- "{q}"' for q in questions)
        questions_section = f"""
The student has also left these questions as comments in their pseudocode:
{formatted}

Address these questions directly in your response, in addition to the hint. Answer them in plain English as part of the same response — do not list them separately, just weave the answers in.
"""

    fix_section = ""
    if fix_requests:
        formatted = "\n".join(f'- Near line `{ctx}`: "{req}"' for req, ctx in fix_requests)
        fix_section = f"""
The student has explicitly asked for an exact fix at these locations:
{formatted}

For each fix request:
- Show the COMPLETE corrected version of that section (not a diff, not a partial change — the full corrected block the student should use).
- Briefly explain in one sentence why the fix is correct.
- You ARE allowed to write pseudocode only for the specific section being fixed.
- Do NOT show fixes for parts the student did not ask about.
"""

    if not has_pseudocode:
        prompt = f"""You are a {board} Computer Science tutor. A student has been given this problem but has not written anything yet.

PROBLEM:
{problem.strip()}
{questions_section}
Give them a concrete first step in plain English — what is the very first thing they need to think about for THIS specific problem? Be specific to the problem, not generic.

RULES:
- Plain English only. No pseudocode keywords (FOR, WHILE, IF, INPUT, OUTPUT, DECLARE, etc.). No code fragments.
- Do not reveal the solution. Do not say what to write.
- Two sentences maximum. No preamble.
"""
    else:
        directness = (
            "Point at the most important issue but keep the hint fairly gentle."
            if attempt_count <= 2 else
            "The student has struggled several times. Be direct and specific about exactly what is wrong and why it doesn't match what the problem is asking for."
        )

        pseudocode_rule = (
            "You ARE allowed to include pseudocode only for the specific lines where the student asked for a fix."
            if fix_requests else
            "No code or pseudocode fragments."
        )

        prompt = f"""You are a {board} Computer Science tutor. A student is attempting this problem:

PROBLEM:
{problem.strip()}

STUDENT'S PSEUDOCODE:
{pseudocode.strip()}
{questions_section}{fix_section}
YOUR JOB — work through all of these internally, then output only the response:
1. Understand exactly what the problem requires: inputs, logic, and outputs.
2. Check whether each instruction is being used correctly — INPUT reads a value into a variable, OUTPUT displays a value. Are they being used for the right purpose?
3. Trace through what the pseudocode actually does step by step.
4. Compare: find the most fundamental mistake — where what the code does diverges from what the problem needs. Prioritise misuse of instructions over stylistic issues.
5. If the student left questions as comments, answer them as part of your response.
6. If the student asked for an exact fix, provide the corrected pseudocode line(s) for those specific locations.

{directness}

STRICT RULES:
- Plain English only for explanations. No pseudocode keywords in the explanation prose.
- {pseudocode_rule}
- Do not reveal the correct answer beyond the specific lines the student asked to fix.
- Be specific to this problem and this student's code. No generic advice.
- No preamble ("Here is a hint:", "Great try!", etc.).
- Maximum three sentences for the hint (slightly more if there are student questions or fix requests to address).
"""

    try:
        return await _ask_gemini(prompt, max_tokens=2000, timeout=15.0)
    except Exception:
        return "Take a moment to review your logic."


async def _generate_ideal_solution(problem: str, board: str) -> str:
    prompt = f"""You are an expert {board} pseudocode examiner.

Write the ideal, clean model-answer pseudocode for this problem:
{problem.strip()}

Requirements:
- Use correct {board} pseudocode syntax and conventions exactly
- Keep it clean, readable, and idiomatic for a {board} exam
- Output pseudocode only — no explanation, no markdown fences, no commentary
"""
    try:
        return await _ask_gemini(prompt, max_tokens=3000, timeout=20.0)
    except Exception:
        return None
