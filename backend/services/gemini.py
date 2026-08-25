import asyncio
import google.generativeai as genai
from config import settings

genai.configure(api_key=settings.GEMINI_API_KEY)
model = genai.GenerativeModel(settings.GEMINI_MODEL)


async def generate(prompt: str, timeout: float) -> str:
    loop = asyncio.get_event_loop()
    response = await asyncio.wait_for(
        loop.run_in_executor(None, lambda: model.generate_content(prompt)),
        timeout=timeout
    )
    return response.text.strip()
