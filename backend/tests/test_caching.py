import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import httpx
import numpy as np
import pytest

from app.api.routes import analysis as analysis_route
from app.api.routes import mapillary as mapillary_route
from app.api.routes import weather as weather_route
from app.data_providers.dem.srtm import SRTMProvider
from app.data_providers.imagery.mapillary import MapillaryImage
from app.data_providers.weather.base import WeatherRecord, WeatherSummary
from app.data_providers.weather.open_meteo import OpenMeteoProvider
from app.fusion.pipeline import AnalysisPipeline
from app.schemas.analysis import AnalysisRequest, AnalysisResult, RiskLayer


@pytest.mark.asyncio
async def test_redis_connection(redis_client):
    assert await redis_client.ping() is True


@pytest.mark.asyncio
async def test_weather_city_level_cache(redis_client, clear_redis):
    provider = OpenMeteoProvider()

    fake_response = Mock()
    fake_response.raise_for_status = Mock()
    fake_response.json.return_value = {
        "hourly": {
            "time": ["2026-04-20T00:00", "2026-04-20T01:00"],
            "precipitation": [1.0, 2.0],
            "temperature_2m": [20.0, 22.0],
            "relative_humidity_2m": [50.0, 55.0],
            "wind_speed_10m": [3.0, 4.0],
        }
    }

    with patch(
        "app.data_providers.weather.open_meteo.httpx.AsyncClient.get",
        new=AsyncMock(return_value=fake_response),
    ) as mock_get:
        first = await provider.fetch_historical(36.84, 10.19, 7)
        second = await provider.fetch_historical(36.83, 10.18, 7)

    assert mock_get.await_count == 1
    assert first.to_dict() == second.to_dict()


@pytest.mark.asyncio
async def test_weather_route_cache_city_rounding(redis_client, clear_redis, app):
    summary = WeatherSummary(
        records=[
            WeatherRecord(
                timestamp=datetime(2026, 4, 20, 0, 0, tzinfo=timezone.utc),
                rainfall_mm=1.0,
                temperature_c=22.5,
                humidity_pct=55.0,
                wind_speed_ms=4.0,
            )
        ],
        total_rainfall_mm=1.0,
        peak_intensity_mm_hr=1.0,
        mean_temp_c=22.5,
        provider="mock-weather",
    )

    fake_provider = Mock()
    fake_provider.fetch_historical = AsyncMock(return_value=summary)

    with patch("app.api.routes.weather.get_weather_provider", return_value=fake_provider):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            r1 = await client.get("/api/v1/weather", params={"lat": 36.84, "lon": 10.19, "days_back": 7})
            r2 = await client.get("/api/v1/weather", params={"lat": 36.83, "lon": 10.18, "days_back": 7})

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json() == r2.json()
    assert fake_provider.fetch_historical.await_count == 1


@pytest.mark.asyncio
async def test_dem_tile_cache():
    provider = SRTMProvider()

    class FakeRedis:
        def __init__(self):
            self._store: dict[str, str] = {}

        async def get(self, key: str):
            return self._store.get(key)

        async def set(self, key: str, value: str, ex: int | None = None):
            self._store[key] = value
            return True

    fake_redis = FakeRedis()

    fake_asc = """ncols 2
nrows 2
xllcorner 0
yllcorner 0
cellsize 1
NODATA_value -9999
1 2
3 4
"""

    fake_response = Mock()
    fake_response.raise_for_status = Mock()
    fake_response.text = fake_asc

    with patch("app.data_providers.dem.srtm.get_redis", new=AsyncMock(return_value=fake_redis)):
        with patch("app.data_providers.dem.srtm.httpx.Client.get", return_value=fake_response) as mock_get:
            first = await asyncio.to_thread(provider.fetch, 10.001, 20.001, 10.099, 20.099)
            second = await asyncio.to_thread(provider.fetch, 10.004, 20.004, 10.096, 20.096)

    assert mock_get.call_count == 1
    assert np.array_equal(first.elevation, second.elevation)


@pytest.mark.asyncio
async def test_mapillary_probe_level_cache(redis_client, clear_redis, app):
    fake_images = [
        MapillaryImage(
            id="img-1",
            lat=36.84,
            lon=10.19,
            captured_at=datetime(2026, 4, 20, 12, 0, tzinfo=timezone.utc),
            thumb_url="https://example.com/thumb.jpg",
            sequence_id="seq-1",
        )
    ]

    req1 = {
        "path": [{"lat": 36.8400, "lon": 10.1900}, {"lat": 36.8420, "lon": 10.1920}],
        "search_radius_meters": 20.0,
        "sample_every_meters": 15.0,
    }
    req2 = {
        "path": [{"lat": 36.8401, "lon": 10.1901}, {"lat": 36.8430, "lon": 10.1930}],
        "search_radius_meters": 20.0,
        "sample_every_meters": 15.0,
    }

    with patch(
        "app.data_providers.imagery.mapillary.MapillaryProvider.fetch_images_by_bbox",
        return_value=fake_images,
    ) as mock_fetch:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            r1 = await client.post("/api/v1/mapillary/images/along-path", json=req1)
            first_calls = mock_fetch.call_count
            r2 = await client.post("/api/v1/mapillary/images/along-path", json=req2)
            second_calls = mock_fetch.call_count

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert second_calls - first_calls < first_calls


@pytest.mark.asyncio
async def test_analysis_bbox_tolerance_2dp(redis_client, clear_redis, app):
    pre_payload = {
        "bbox": {"west": 10.114, "south": 36.804, "east": 10.196, "north": 36.896},
        "weather_days_back": 7,
    }
    req_model = AnalysisRequest.model_validate(pre_payload)
    bbox_key = analysis_route._bbox_cache_key(req_model)

    cached_result = AnalysisResult(
        run_id=uuid4(),
        status="completed",
        flood_layers=[
            RiskLayer(
                risk_type="flood",
                score=0.6,
                geometry={"type": "Polygon", "coordinates": []},
                components={"rain": 0.6},
            )
        ],
        heat_layers=[],
        image_count=2,
        simulation_engine_used="cached",
    )
    await redis_client.set(bbox_key, cached_result.model_dump_json(), ex=3600)

    request_payload = {
        "bbox": {"west": 10.1136, "south": 36.8036, "east": 10.1964, "north": 36.8964},
        "weather_days_back": 7,
    }

    with patch("app.api.routes.analysis.AnalysisPipeline") as mock_pipeline:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post("/api/v1/analysis/run", json=request_payload)

    assert response.status_code == 200
    data = response.json()
    assert "flood_layers" in data
    assert data["status"] == "completed"
    assert mock_pipeline.call_count == 0


@pytest.mark.asyncio
async def test_pipeline_smart_component_reuse(redis_client, clear_redis):
    request = AnalysisRequest.model_validate(
        {
            "bbox": {"west": 10.11, "south": 36.80, "east": 10.20, "north": 36.90},
            "weather_days_back": 7,
        }
    )
    run_id = uuid4()

    cx = (request.bbox.west + request.bbox.east) / 2
    cy = (request.bbox.south + request.bbox.north) / 2
    weather_key = f"weather:{round(cy,1)}:{round(cx,1)}:{request.weather_days_back}"
    snap = lambda value: round(round(value / 0.01) * 0.01, 2)
    dem_key = f"dem:{snap(request.bbox.west):.2f}:{snap(request.bbox.south):.2f}:{snap(request.bbox.east):.2f}:{snap(request.bbox.north):.2f}"

    weather_summary = WeatherSummary(
        records=[
            WeatherRecord(
                timestamp=datetime(2026, 4, 20, 0, 0, tzinfo=timezone.utc),
                rainfall_mm=0.5,
                temperature_c=21.0,
                humidity_pct=60.0,
                wind_speed_ms=3.0,
            )
        ],
        total_rainfall_mm=0.5,
        peak_intensity_mm_hr=0.5,
        mean_temp_c=21.0,
        provider="cached",
    )
    dem_cached = {
        "elevation": [[10.0, 11.0], [12.0, 13.0]],
        "resolution_m": 30.0,
        "bbox": [request.bbox.west, request.bbox.south, request.bbox.east, request.bbox.north],
        "provider": "cached-dem",
        "crs": "EPSG:4326",
    }

    await redis_client.set(weather_key, json.dumps(weather_summary.to_dict()), ex=3600)
    await redis_client.set(dem_key, json.dumps(dem_cached), ex=86400)

    mapillary_images = [
        MapillaryImage(
            id="img-1",
            lat=36.84,
            lon=10.19,
            captured_at=datetime(2026, 4, 20, 12, 0, tzinfo=timezone.utc),
            thumb_url="https://example.com/thumb.jpg",
            sequence_id="seq-1",
        )
    ]

    with patch("app.fusion.pipeline.get_weather_provider") as mock_weather_provider:
        weather_instance = mock_weather_provider.return_value
        weather_instance.fetch_historical = AsyncMock(side_effect=AssertionError("weather fetch should not be called"))

        with patch("app.fusion.pipeline.get_dem_provider") as mock_dem_provider:
            dem_instance = mock_dem_provider.return_value
            dem_instance.fetch = Mock(side_effect=AssertionError("dem fetch should not be called"))

            with patch(
                "app.fusion.pipeline.MapillaryProvider.fetch_images_by_bbox",
                return_value=mapillary_images,
            ) as mock_mapillary_fetch:
                with patch("app.fusion.pipeline.TerrainAnalyzer.process") as mock_terrain_process:
                    mock_terrain_process.return_value = SimpleNamespace(
                        elevation=np.array([[1.0, 2.0], [3.0, 4.0]], dtype=float),
                        slope_deg=np.array([[0.1, 0.2], [0.3, 0.4]], dtype=float),
                    )
                    with patch("app.fusion.pipeline.WeatherAnalyzer.process") as mock_weather_process:
                        mock_weather_process.return_value = SimpleNamespace(
                            total_rainfall_mm=1.0,
                            peak_intensity_mm_hr=0.5,
                        )
                        with patch("app.fusion.pipeline.VisionAnalyzer.process") as mock_vision_process:
                            mock_vision_process.return_value = SimpleNamespace()
                            with patch("app.fusion.pipeline.get_simulation_engine") as mock_get_engine:
                                fake_engine = Mock()
                                fake_engine.name = "null"
                                fake_engine.run.return_value = SimpleNamespace()
                                mock_get_engine.return_value = fake_engine

                                with patch("app.fusion.pipeline.FloodRiskEngine.compute") as mock_flood_compute:
                                    mock_flood_compute.return_value = SimpleNamespace(
                                        score=np.array([[0.5]]),
                                        category=np.array([["low"]]),
                                        components=np.array([[{"rain": 0.5}]], dtype=object),
                                    )
                                    with patch("app.fusion.pipeline.HeatRiskEngine.compute") as mock_heat_compute:
                                        mock_heat_compute.return_value = SimpleNamespace(
                                            score=np.array([[0.4]]),
                                            category=np.array([["low"]]),
                                            components=np.array([[{"temp": 0.4}]], dtype=object),
                                        )
                                        with patch("app.fusion.pipeline.grid_to_geojson_polygons", return_value=[]):
                                            result = await AnalysisPipeline().run(request, run_id)

    assert result.status == "completed"
    assert mock_mapillary_fetch.call_count == 1


@pytest.mark.asyncio
async def test_redis_fallback_when_unavailable(app):
    provider = OpenMeteoProvider()

    fake_response = Mock()
    fake_response.raise_for_status = Mock()
    fake_response.json.return_value = {
        "hourly": {
            "time": ["2026-04-20T00:00"],
            "precipitation": [0.5],
            "temperature_2m": [21.0],
            "relative_humidity_2m": [60.0],
            "wind_speed_10m": [3.5],
        }
    }

    with patch("app.data_providers.weather.open_meteo.get_redis", new=AsyncMock(return_value=None)):
        with patch(
            "app.data_providers.weather.open_meteo.httpx.AsyncClient.get",
            new=AsyncMock(return_value=fake_response),
        ):
            summary = await provider.fetch_historical(36.84, 10.19, 7)

    assert isinstance(summary, WeatherSummary)
    assert len(summary.records) == 1

    fake_result = AnalysisResult(
        run_id=uuid4(),
        status="completed",
        flood_layers=[],
        heat_layers=[],
        image_count=0,
        simulation_engine_used="mock",
    )

    req_payload = {
        "bbox": {"west": 10.11, "south": 36.80, "east": 10.20, "north": 36.90},
        "weather_days_back": 7,
    }

    with patch("app.api.routes.analysis.get_redis", new=AsyncMock(return_value=None)):
        with patch.object(
            analysis_route.AnalysisPipeline,
            "run",
            new=AsyncMock(return_value=fake_result),
        ):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post("/api/v1/analysis/run", json=req_payload)

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "pending"
    assert "run_id" in data
