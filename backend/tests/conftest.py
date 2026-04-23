import sys
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import FastAPI

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database import get_db
from app.core import redis as redis_core
from app.main import app as fastapi_app


class DummySession:
    def add(self, _obj) -> None:
        return None

    async def commit(self) -> None:
        return None


@pytest_asyncio.fixture(scope="function")
async def redis_client():
    redis_core._client = None
    client = await redis_core.get_redis()
    if client is None:
        pytest.skip("Redis is not running; skipping Redis-dependent caching tests")
    assert await client.ping() is True
    yield client
    await client.aclose()
    redis_core._client = None


@pytest.fixture(scope="function")
def app() -> FastAPI:
    async def _override_get_db():
        yield DummySession()

    fastapi_app.dependency_overrides[get_db] = _override_get_db
    try:
        yield fastapi_app
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture(scope="function")
async def clear_redis(redis_client):
    patterns = ["test:*", "weather:*", "weather_route:*", "mapillary:*", "dem:*", "analysis:*"]

    async def _delete_patterns() -> None:
        for pattern in patterns:
            keys = [key async for key in redis_client.scan_iter(match=pattern)]
            if keys:
                await redis_client.delete(*keys)

    await _delete_patterns()
    yield
    await _delete_patterns()
