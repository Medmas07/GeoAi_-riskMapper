"""
Main analysis pipeline — orchestrates all data fetching, processing, and risk scoring.
Returns GeoJSON-ready risk layers.
"""
import asyncio
import json
import logging
import numpy as np
from uuid import UUID
from typing import Awaitable, Callable, TypeVar
from app.schemas.analysis import AnalysisRequest, AnalysisResult, ImagePoint, RiskLayer
from app.data_providers.weather.factory import get_weather_provider
from app.data_providers.weather.base import WeatherSummary
from app.data_providers.dem.factory import get_dem_provider
from app.data_providers.dem.base import DEMData
from app.data_providers.imagery.mapillary import MapillaryProvider
from app.core.redis import get_redis
from app.processing.terrain.analyzer import TerrainAnalyzer
from app.processing.weather.analyzer import WeatherAnalyzer
from app.processing.vision.analyzer import VisionAnalyzer
from app.simulation.factory import get_simulation_engine
from app.simulation.base import SimulationInput
from app.risk_engine.flood import FloodRiskEngine
from app.risk_engine.heat import HeatRiskEngine
from app.fusion.grid_to_geojson import grid_to_geojson_polygons

T = TypeVar("T")
logger = logging.getLogger(__name__)


def _snap(value: float) -> float:
    return round(round(value / 0.01) * 0.01, 2)


async def get_cached_or_fetch(
    cache_key: str,
    loader: Callable[[], Awaitable[T]],
    deserialize: Callable[[str], T],
    serialize: Callable[[T], str],
    ttl_seconds: int,
) -> T:
    redis = await get_redis()
    if redis is not None:
        try:
            cached = await redis.get(cache_key)
            if cached:
                return deserialize(cached)
        except Exception:
            pass

    value = await loader()
    if redis is not None:
        try:
            await redis.set(cache_key, serialize(value), ex=ttl_seconds)
        except Exception:
            pass
    return value


class AnalysisPipeline:
    def __init__(self, engine_override: str | None = None):
        self.engine_override = engine_override

    async def run(self, request: AnalysisRequest, run_id: UUID) -> AnalysisResult:
        bbox = request.bbox
        cx = (bbox.west + bbox.east) / 2
        cy = (bbox.south + bbox.north) / 2

        # ── 1. DATA FETCHING ────────────────────────────────────────────────
        weather_prov = get_weather_provider()
        dem_prov = get_dem_provider()
        mapillary = MapillaryProvider()
        weather_key = f"weather:{round(cy,1)}:{round(cx,1)}:{request.weather_days_back}"
        dem_key = (
            f"dem:{_snap(bbox.west):.2f}:{_snap(bbox.south):.2f}:"
            f"{_snap(bbox.east):.2f}:{_snap(bbox.north):.2f}"
        )

        weather_task = asyncio.create_task(
            get_cached_or_fetch(
                cache_key=weather_key,
                loader=lambda: weather_prov.fetch_historical(cy, cx, request.weather_days_back),
                deserialize=lambda raw: WeatherSummary.from_dict(json.loads(raw)),
                serialize=lambda value: json.dumps(value.to_dict()),
                ttl_seconds=3_600,
            )
        )
        dem_task = asyncio.create_task(
            get_cached_or_fetch(
                cache_key=dem_key,
                loader=lambda: asyncio.to_thread(dem_prov.fetch, bbox.west, bbox.south, bbox.east, bbox.north),
                deserialize=lambda raw: DEMData.from_dict(json.loads(raw)),
                serialize=lambda value: json.dumps(value.to_dict()),
                ttl_seconds=86_400,
            )
        )
        async def _safe_fetch_images():
            try:
                return await asyncio.to_thread(
                    mapillary.fetch_images_by_bbox,
                    bbox.west,
                    bbox.south,
                    bbox.east,
                    bbox.north,
                    100,
                )
            except Exception as exc:
                logger.warning("Mapillary imagery unavailable for bbox: %s", exc)
                return []

        images_task = asyncio.create_task(_safe_fetch_images())

        weather_summary, dem_data, images = await asyncio.gather(
            weather_task,
            dem_task,
            images_task,
        )

        # ── 2. PROCESSING ───────────────────────────────────────────────────
        terrain_features = TerrainAnalyzer().process(dem_data)
        weather_features = WeatherAnalyzer().process(weather_summary)
        vision_summary = VisionAnalyzer().process(images)

        # ── 3. SIMULATION ───────────────────────────────────────────────────
        engine = get_simulation_engine(self.engine_override)
        sim_input = SimulationInput(
            dem_array=terrain_features.elevation,
            slope_array=terrain_features.slope_deg,
            rainfall_mm=weather_features.total_rainfall_mm,
            rainfall_intensity=weather_features.peak_intensity_mm_hr,
            bbox=bbox.to_list(),
            resolution_m=dem_data.resolution_m,
        )
        sim_result = engine.run(sim_input)

        # ── 4. RISK SCORING ─────────────────────────────────────────────────
        flood_grid = FloodRiskEngine().compute(
            terrain_features, weather_features, vision_summary, sim_result
        )
        heat_grid = HeatRiskEngine().compute(
            terrain_features, weather_features, vision_summary
        )

        if float(flood_grid.score.mean()) < 0.15:
            logger.warning(
                "Flood scores very low (mean=%.3f), likely missing vision/sim data",
                float(flood_grid.score.mean()),
            )

        # ── 5. EXPORT TO GEOJSON ────────────────────────────────────────────
        flood_layers = grid_to_geojson_polygons(
            flood_grid.score, flood_grid.category, flood_grid.components,
            bbox.to_list(), dem_data.resolution_m, risk_type="flood"
        )
        heat_layers = grid_to_geojson_polygons(
            heat_grid.score, heat_grid.category, heat_grid.components,
            bbox.to_list(), dem_data.resolution_m, risk_type="heat",
            min_category=0,
        )

        # Guarantee at least one heat layer so frontend always has component stats.
        # Even if all cells score 0 (e.g. cold winter data), the stats panel still works.
        if not heat_layers:
            heat_layers = [RiskLayer(
                risk_type="heat",
                score=round(float(heat_grid.score.mean()), 3),
                geometry={
                    "type": "Polygon",
                    "coordinates": [[
                        [bbox.west, bbox.north], [bbox.east, bbox.north],
                        [bbox.east, bbox.south], [bbox.west, bbox.south],
                        [bbox.west, bbox.north],
                    ]],
                },
                components={**heat_grid.components, "category": 0},
            )]

        mapped_images = [
            ImagePoint(
                id=str(img.id),
                url=str(img.thumb_url or ""),
                lat=float(img.lat),
                lon=float(img.lon),
            )
            for img in (images or [])
            if getattr(img, "lat", None)
            and getattr(img, "lon", None)
            and getattr(img, "thumb_url", None)
        ][:200]

        logger.info(
            "Pipeline complete — %d flood polygons, %d heat polygons, %d images with thumbnails",
            len(flood_layers),
            len(heat_layers),
            len([i for i in images if getattr(i, "thumb_url", None)]),
        )

        return AnalysisResult(
            run_id=run_id,
            status="completed",
            flood_layers=flood_layers,
            heat_layers=heat_layers,
            images=mapped_images,
            image_count=len(mapped_images),
            simulation_engine_used=engine.name,
        )
