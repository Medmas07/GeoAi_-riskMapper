from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import math
from app.data_providers.imagery.mapillary import MapillaryProvider, MapillaryImage

router = APIRouter(prefix="/mapillary", tags=["mapillary"])


class ImageResponse(BaseModel):
    id: str
    lat: float
    lon: float
    thumb_url: Optional[str]
    captured_at: Optional[str]


class PathPoint(BaseModel):
    lat: float
    lon: float


class ImagesAlongPathRequest(BaseModel):
    path: list[PathPoint] = Field(min_length=2)
    width_meters: float = Field(default=25.0, ge=5.0, le=200.0)
    per_segment_limit: int = Field(default=120, ge=20, le=500)


def _meters_per_degree_lat() -> float:
    return 111_320.0


def _meters_per_degree_lon(lat: float) -> float:
    return 111_320.0 * math.cos(math.radians(lat))


def _segment_length_m(a: PathPoint, b: PathPoint) -> float:
    mid_lat = (a.lat + b.lat) / 2.0
    dx = (b.lon - a.lon) * _meters_per_degree_lon(mid_lat)
    dy = (b.lat - a.lat) * _meters_per_degree_lat()
    return math.hypot(dx, dy)


def _project_point_on_segment(lat: float, lon: float, a: PathPoint, b: PathPoint):
    mid_lat = (a.lat + b.lat) / 2.0
    mx = _meters_per_degree_lon(mid_lat)
    my = _meters_per_degree_lat()

    ax = a.lon * mx
    ay = a.lat * my
    bx = b.lon * mx
    by = b.lat * my
    px = lon * mx
    py = lat * my

    abx = bx - ax
    aby = by - ay
    apx = px - ax
    apy = py - ay
    denom = abx * abx + aby * aby

    if denom == 0:
        return 0.0, math.hypot(apx, apy)

    t_raw = (apx * abx + apy * aby) / denom
    t = max(0.0, min(1.0, t_raw))
    qx = ax + t * abx
    qy = ay + t * aby
    return t, math.hypot(px - qx, py - qy)


@router.get("/images", response_model=list[ImageResponse])
async def get_images(
    west: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    north: float = Query(...),
    limit: int = Query(100, ge=1, le=500),
):
    try:
        provider = MapillaryProvider()
        images = provider.fetch_images_by_bbox(west, south, east, north, limit)
        return [
            ImageResponse(
                id=img.id,
                lat=img.lat,
                lon=img.lon,
                thumb_url=img.thumb_url,
                captured_at=img.captured_at.isoformat() if img.captured_at else None,
            )
            for img in images
        ]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Mapillary error: {e}")


@router.post("/images/along-path", response_model=list[ImageResponse])
async def get_images_along_path(req: ImagesAlongPathRequest):
    try:
        provider = MapillaryProvider()

        path = req.path
        width_m = req.width_meters

        seen: set[str] = set()
        candidates: list[MapillaryImage] = []

        for i in range(len(path) - 1):
            a = path[i]
            b = path[i + 1]

            mid_lat = (a.lat + b.lat) / 2.0
            lat_pad = width_m / _meters_per_degree_lat()
            lon_div = max(_meters_per_degree_lon(mid_lat), 1.0)
            lon_pad = width_m / lon_div

            west = min(a.lon, b.lon) - lon_pad
            east = max(a.lon, b.lon) + lon_pad
            south = min(a.lat, b.lat) - lat_pad
            north = max(a.lat, b.lat) + lat_pad

            segment_imgs = provider.fetch_images_by_bbox(
                west,
                south,
                east,
                north,
                limit=req.per_segment_limit,
            )

            for img in segment_imgs:
                if img.id in seen:
                    continue
                seen.add(img.id)
                candidates.append(img)

        if not candidates:
            return []

        cumulative = [0.0]
        for i in range(1, len(path)):
            cumulative.append(cumulative[i - 1] + _segment_length_m(path[i - 1], path[i]))

        scored = []
        for img in candidates:
            best_distance = float("inf")
            best_progress = 0.0

            for i in range(len(path) - 1):
                a = path[i]
                b = path[i + 1]
                t, distance_m = _project_point_on_segment(img.lat, img.lon, a, b)
                seg_len = _segment_length_m(a, b)
                progress = cumulative[i] + t * seg_len
                if distance_m < best_distance:
                    best_distance = distance_m
                    best_progress = progress

            if best_distance <= width_m:
                scored.append((img, best_progress, best_distance))

        if not scored:
            return []

        scored.sort(key=lambda x: (x[1], x[2]))

        min_spacing_m = max(5.0, min(20.0, width_m * 0.4))
        filtered: list[tuple[MapillaryImage, float, float]] = []
        last_progress = -1e12
        for item in scored:
            progress = item[1]
            if progress - last_progress >= min_spacing_m:
                filtered.append(item)
                last_progress = progress

        return [
            ImageResponse(
                id=img.id,
                lat=img.lat,
                lon=img.lon,
                thumb_url=img.thumb_url,
                captured_at=img.captured_at.isoformat() if img.captured_at else None,
            )
            for img, _, _ in filtered
        ]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Mapillary path error: {e}")
