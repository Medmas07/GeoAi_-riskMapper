import httpx
import pytest
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient


@pytest.mark.asyncio
async def test_assistant_chat_returns_500_when_key_missing(app):
    with patch("app.api.routes.assistant._resolve_groq_api_key", return_value=""):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/assistant/chat",
                json={
                    "messages": [{"role": "user", "content": "hello"}],
                    "tools": [],
                },
            )

    assert response.status_code == 500
    assert response.json()["detail"] == "GROQ_API_KEY is not configured"


def test_assistant_chat_proxies_to_groq_successfully(app):
    captured: dict[str, object] = {"calls": 0}

    fake_response = Mock()
    fake_response.status_code = 200
    fake_response.text = ""
    fake_response.json.return_value = {
        "id": "chatcmpl-test",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "Hello from mocked Groq"},
                "finish_reason": "stop",
            }
        ],
    }

    class FakeGroqClient:
        def __init__(self, *args, **kwargs):
            self._init_args = args
            self._init_kwargs = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, **kwargs):
            captured["calls"] = int(captured["calls"]) + 1
            captured["url"] = url
            captured["kwargs"] = kwargs
            return fake_response

    with patch("app.api.routes.assistant._resolve_groq_api_key", return_value="test-key"), patch(
        "app.api.routes.assistant._resolve_groq_model", return_value="llama-3.3-70b-versatile"
    ), patch("app.api.routes.assistant.httpx.AsyncClient", new=FakeGroqClient):
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/assistant/chat",
                json={
                    "messages": [{"role": "user", "content": "test"}],
                    "tools": [],
                    "temperature": 0.1,
                    "max_tokens": 64,
                },
            )

    assert response.status_code == 200
    payload = response.json()
    assert payload["choices"][0]["message"]["content"] == "Hello from mocked Groq"

    assert captured["calls"] == 1
    called_url = captured.get("url")
    called_kwargs = captured.get("kwargs", {})
    called_headers = called_kwargs.get("headers")
    called_json = called_kwargs.get("json")

    assert called_url == "https://api.groq.com/openai/v1/chat/completions"
    assert called_headers is not None
    assert called_json is not None
    assert called_headers["Authorization"] == "Bearer test-key"
    assert called_json["model"] == "llama-3.3-70b-versatile"
    assert called_json["messages"][0]["role"] == "user"
    assert called_json["stream"] is False
