import json

from fastapi import APIRouter, Query
from pydantic import BaseModel
from app.data_providers.weather.factory import get_weather_provider
from app.core.redis import get_redis

router = APIRouter(prefix="/weather", tags=["weather"])

CACHE_TTL = 3600  # 1 hour


def _cache_key(lat, lon, days_back):
    return f"{round(lat,1)}:{round(lon,1)}:{days_back}"


class WeatherResponse(BaseModel):
    total_rainfall_mm: float
    peak_intensity_mm_hr: float
    mean_temp_c: float
    provider: str
    record_count: int


@router.get("", response_model=WeatherResponse)
async def get_weather(
    lat: float = Query(...),
    lon: float = Query(...),
    days_back: int = Query(7, ge=1, le=90),
):
    key = f"weather_route:{_cache_key(lat, lon, days_back)}"
    redis = await get_redis()
    if redis is not None:
        try:
            cached = await redis.get(key)
            if cached:
                return WeatherResponse.model_validate(json.loads(cached))
        except Exception:
            pass

    provider = get_weather_provider()
    summary = await provider.fetch_historical(lat, lon, days_back)
    response = WeatherResponse(
        total_rainfall_mm=summary.total_rainfall_mm,
        peak_intensity_mm_hr=summary.peak_intensity_mm_hr,
        mean_temp_c=summary.mean_temp_c,
        provider=summary.provider,
        record_count=len(summary.records),
    )
    if redis is not None:
        try:
            await redis.set(key, response.model_dump_json(), ex=CACHE_TTL)
        except Exception:
            pass
    return response
