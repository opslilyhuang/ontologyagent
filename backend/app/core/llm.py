"""DeepSeek LLM 封装 — 兼容 OpenAI SDK。"""
import json
from typing import Any

from openai import AsyncOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from .config import settings

_client: AsyncOpenAI | None = None


def get_llm_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
        )
    return _client


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=30))
async def llm_chat(prompt: str, *, system: str = "", temperature: float = 0.3) -> str:
    """单轮对话封装，返回 content 字符串。"""
    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    resp = await get_llm_client().chat.completions.create(
        model=settings.deepseek_model,
        messages=messages,
        temperature=temperature,
    )
    return resp.choices[0].message.content or ""


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=30))
async def llm_chat_json(prompt: str, *, system: str = "") -> Any:
    """要求模型返回 JSON，自动解析。"""
    raw = await llm_chat(
        prompt,
        system=(system or "") + "\n必须只返回合法JSON，不要添加任何其他文字。",
        temperature=0.1,
    )
    # 提取 ```json``` 块
    if "```json" in raw:
        raw = raw.split("```json")[1].split("```")[0].strip()
    elif "```" in raw:
        raw = raw.split("```")[1].split("```")[0].strip()
    return json.loads(raw)
