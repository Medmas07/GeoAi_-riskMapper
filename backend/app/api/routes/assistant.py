from typing import Any, Literal
from pathlib import Path

import httpx
from dotenv import dotenv_values
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.config import settings

router = APIRouter(prefix="/assistant", tags=["assistant"])


_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


def _resolve_groq_api_key() -> str:
    configured = (settings.GROQ_API_KEY or "").strip()
    if configured:
        return configured

    env_data = dotenv_values(_ENV_FILE)
    return str(env_data.get("GROQ_API_KEY") or "").strip()


def _resolve_groq_model(body_model: str | None) -> str:
    if body_model and body_model.strip():
        return body_model.strip()

    configured = (settings.GROQ_MODEL or "").strip()
    if configured:
        return configured

    env_data = dotenv_values(_ENV_FILE)
    return str(env_data.get("GROQ_MODEL") or "llama-3.3-70b-versatile").strip()


class AssistantMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str | None = ""
    tool_call_id: str | None = None
    tool_calls: list[dict[str, Any]] | None = None


class AssistantChatRequest(BaseModel):
    messages: list[AssistantMessage] = Field(default_factory=list)
    tools: list[dict[str, Any]] = Field(default_factory=list)
    model: str | None = None
    temperature: float = 0.2
    max_tokens: int = 1200
    tool_choice: str | dict[str, Any] = "auto"


@router.post("/chat")
async def chat(body: AssistantChatRequest):
    groq_api_key = _resolve_groq_api_key()
    if not groq_api_key:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY is not configured")

    payload: dict[str, Any] = {
        "model": _resolve_groq_model(body.model),
        "messages": [m.model_dump(exclude_none=True) for m in body.messages],
        "tools": body.tools,
        "tool_choice": body.tool_choice,
        "temperature": body.temperature,
        "max_tokens": body.max_tokens,
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {groq_api_key}"},
            json=payload,
        )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Groq error: {response.text}")

    return response.json()


@router.post("/chat/stream")
async def chat_stream(body: AssistantChatRequest):
    groq_api_key = _resolve_groq_api_key()
    if not groq_api_key:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY is not configured")

    payload = {
        "model": _resolve_groq_model(body.model),
        "messages": [m.model_dump(exclude_none=True) for m in body.messages],
        "tools": body.tools,
        "tool_choice": body.tool_choice,
        "temperature": body.temperature,
        "max_tokens": body.max_tokens,
        "stream": True,
    }

    async def generate():
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {groq_api_key}"},
                json=payload,
            ) as resp:
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        yield f"{line}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")