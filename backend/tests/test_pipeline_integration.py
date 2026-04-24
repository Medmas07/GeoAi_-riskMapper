from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import asyncio
import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from app.api.routes import analysis as analysis_route
from app.schemas.analysis import AnalysisResult


async def _post_json(app, path: str, payload: dict):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post(path, json=payload)


async def _get(app, path: str):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


@pytest.mark.asyncio
async def test_analysis_run_returns_run_id(app):
    with patch("app.api.routes.analysis._execute_pipeline", new=AsyncMock(return_value=None)):
        response = await _post_json(
            app,
            "/api/v1/analysis/run",
            {
                "bbox": {
                    "west": 10.10,
                    "south": 36.74,
                    "east": 10.28,
                    "north": 36.91,
                },
                "weather_days_back": 7,
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert "run_id" in data
    assert data["status"] in {"pending", "completed"}


@pytest.mark.asyncio
async def test_analysis_get_pending(app):
    fake_uuid = uuid4()
    response = await _get(app, f"/api/v1/analysis/{fake_uuid}")

    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert data["status"] in {"running", "pending"}


@pytest.mark.asyncio
async def test_assistant_chat_geocode_tool(app):
    fake_groq_response = {
        "id": "chatcmpl-test",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {
                                "name": "geocode_location",
                                "arguments": '{"location":"Sousse, Tunisia"}',
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
    }

    class FakeGroqClient:
        def __init__(self, *args, **kwargs):
            self._args = args
            self._kwargs = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *_args, **_kwargs):
            return SimpleNamespace(
                status_code=200,
                text="",
                json=lambda: fake_groq_response,
            )

    with patch("app.api.routes.assistant._resolve_groq_api_key", return_value="test-key"), patch(
        "app.api.routes.assistant.httpx.AsyncClient", new=FakeGroqClient
    ):
        response = await _post_json(
            app,
            "/api/v1/assistant/chat",
            {
                "messages": [{"role": "user", "content": "Show me Sousse"}],
                "tools": [],
                "model": "llama-3.3-70b-versatile",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["choices"][0]["message"]["tool_calls"][0]["function"]["name"] == "geocode_location"


@pytest.mark.asyncio
async def test_assistant_chat_no_tool_for_knowledge(app):
    fake_groq_response = {
        "id": "chatcmpl-test",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "Flash floods are caused by short intense rainfall, impermeable surfaces, and poor drainage.",
                },
                "finish_reason": "stop",
            }
        ],
    }

    class FakeGroqClient:
        def __init__(self, *args, **kwargs):
            self._args = args
            self._kwargs = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *_args, **_kwargs):
            return SimpleNamespace(
                status_code=200,
                text="",
                json=lambda: fake_groq_response,
            )

    with patch("app.api.routes.assistant._resolve_groq_api_key", return_value="test-key"), patch(
        "app.api.routes.assistant.httpx.AsyncClient", new=FakeGroqClient
    ):
        response = await _post_json(
            app,
            "/api/v1/assistant/chat",
            {
                "messages": [{"role": "user", "content": "What causes flash floods?"}],
                "tools": [],
                "model": "llama-3.3-70b-versatile",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    message = payload["choices"][0]["message"]
    assert message.get("tool_calls") in (None, [])
    assert isinstance(message.get("content"), str)
    assert message.get("content")


@pytest.mark.asyncio
async def test_assistant_stream_endpoint(app):
    class FakeGroqStreamResponse:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def aiter_lines(self):
            yield 'data: {"choices":[{"delta":{"content":"Hello"}}]}'
            yield "data: [DONE]"

    class FakeGroqClient:
        def __init__(self, *args, **kwargs):
            self._args = args
            self._kwargs = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, *_args, **_kwargs):
            return FakeGroqStreamResponse()

    with patch("app.api.routes.assistant._resolve_groq_api_key", return_value="test-key"), patch(
        "app.api.routes.assistant.httpx.AsyncClient", new=FakeGroqClient
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/assistant/chat/stream",
                json={
                    "messages": [{"role": "user", "content": "Hello"}],
                    "tools": [],
                    "model": "llama-3.3-70b-versatile",
                },
            )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "data: " in response.text


@pytest.mark.asyncio
async def test_analysis_result_has_correct_structure(app):
    async def fake_execute_pipeline(run_id, request, db, bbox_key):
        fake_result = AnalysisResult.model_validate(
            {
                "run_id": str(run_id),
                "status": "completed",
                "flood_layers": [
                    {
                        "score": 0.7,
                        "risk_type": "flood",
                        "geometry": {"type": "Polygon", "coordinates": [[]]},
                        "components": {"category": 3},
                    }
                ],
                "heat_layers": [],
                "images": [
                    {
                        "id": "x",
                        "url": "http://x.com/x.jpg",
                        "lat": 36.8,
                        "lon": 10.1,
                    }
                ],
                "image_count": 1,
                "simulation_engine_used": "null",
            }
        )
        await analysis_route._store_result(str(run_id), fake_result)

    with patch("app.api.routes.analysis._execute_pipeline", new=fake_execute_pipeline):
        post_response = await _post_json(
            app,
            "/api/v1/analysis/run",
            {
                "bbox": {
                    "west": 10.10,
                    "south": 36.74,
                    "east": 10.28,
                    "north": 36.91,
                },
                "weather_days_back": 7,
            },
        )

    assert post_response.status_code == 200
    run_id = post_response.json()["run_id"]

    get_data = None
    for _ in range(20):
        get_response = await _get(app, f"/api/v1/analysis/{run_id}")
        assert get_response.status_code == 200
        payload = get_response.json()
        if payload.get("status") == "completed":
            get_data = payload
            break
        await asyncio.sleep(0.01)

    assert get_data is not None
    assert len(get_data["flood_layers"]) == 1
    assert get_data["flood_layers"][0]["score"] == 0.7
    assert len(get_data["images"]) == 1
