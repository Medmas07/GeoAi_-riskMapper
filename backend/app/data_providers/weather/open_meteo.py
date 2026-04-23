import json
import httpx
from datetime import datetime, timedelta, timezone
from app.data_providers.weather.base import WeatherProvider, WeatherRecord, WeatherSummary
from app.core.redis import get_redis


class OpenMeteoProvider(WeatherProvider):
    BASE = "https://api.open-meteo.com/v1"
    ARCHIVE_BASE = "https://archive-api.open-meteo.com/v1"
    CACHE_TTL = 3600

    async def fetch_historical(self, lat: float, lon: float, days_back: int) -> WeatherSummary:
        cache_key = f"weather:{round(lat,1)}:{round(lon,1)}:{days_back}"
        redis = await get_redis()
        if redis is not None:
            try:
                cached = await redis.get(cache_key)
                if cached:
                    return WeatherSummary.from_dict(json.loads(cached))
            except Exception:
                pass

        end = datetime.now(timezone.utc).date()
        start = end - timedelta(days=days_back)

        params = {
            "latitude": lat,
            "longitude": lon,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "hourly": "precipitation,temperature_2m,relative_humidity_2m,wind_speed_10m",
            "timezone": "UTC",
        }

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{self.ARCHIVE_BASE}/archive", params=params)
            r.raise_for_status()
            data = r.json()

        hourly = data["hourly"]
        records = []
        for i, ts in enumerate(hourly["time"]):
            records.append(WeatherRecord(
                timestamp=datetime.fromisoformat(ts),
                rainfall_mm=hourly["precipitation"][i] or 0.0,
                temperature_c=hourly["temperature_2m"][i] or 0.0,
                humidity_pct=hourly["relative_humidity_2m"][i] or 0.0,
                wind_speed_ms=hourly["wind_speed_10m"][i] or 0.0,
            ))

        total_rain = sum(r.rainfall_mm for r in records)
        # Peak intensity: max over any 1-hour window
        peak = max((r.rainfall_mm for r in records), default=0.0)
        mean_temp = sum(r.temperature_c for r in records) / max(len(records), 1)

        summary = WeatherSummary(
            records=records,
            total_rainfall_mm=total_rain,
            peak_intensity_mm_hr=peak,
            mean_temp_c=mean_temp,
            provider="open_meteo",
        )
        if redis is not None:
            try:
                await redis.set(cache_key, json.dumps(summary.to_dict()), ex=self.CACHE_TTL)
            except Exception:
                pass
        return summary

    async def fetch_current(self, lat: float, lon: float) -> WeatherRecord:
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": "precipitation,temperature_2m,relative_humidity_2m,wind_speed_10m",
        }
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{self.BASE}/forecast", params=params)
            r.raise_for_status()
            data = r.json()

        c = data["current"]
        return WeatherRecord(
            timestamp=datetime.fromisoformat(c["time"]),
            rainfall_mm=c.get("precipitation", 0.0) or 0.0,
            temperature_c=c.get("temperature_2m", 0.0) or 0.0,
            humidity_pct=c.get("relative_humidity_2m", 0.0) or 0.0,
            wind_speed_ms=c.get("wind_speed_10m", 0.0) or 0.0,
        )
