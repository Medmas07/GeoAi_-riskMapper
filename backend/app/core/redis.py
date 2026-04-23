import os
import redis.asyncio as aioredis

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

_client: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis | None:
    global _client
    if _client is None:
        try:
            _client = aioredis.from_url(REDIS_URL, decode_responses=True)
            await _client.ping()
        except Exception:
            _client = None
    return _client