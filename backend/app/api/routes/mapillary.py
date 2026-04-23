import asyncio
import json
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import math
from datetime import datetime
from app.data_providers.imagery.mapillary import MapillaryProvider, MapillaryImage
from app.core.redis import get_redis

router = APIRouter(prefix="/mapillary", tags=["mapillary"])


# ── Response / Request models ────────────────────────────────────────────────

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
    # Tight search radius around each road coordinate — default 20 m.
    # This replaces the old "width_meters" corridor concept entirely.
    # 20 m covers the road width + additional GPS drift tolerance.
    search_radius_meters: float = Field(default=20.0, ge=5.0, le=50.0)
    # How densely to sample the path (every N metres place a probe point).
    # OSRM routes can have hundreds of coords already; we subsample to avoid
    # hammering the Mapillary API with redundant bbox calls.
    sample_every_meters: float = Field(default=15.0, ge=5.0, le=100.0)


# ── Geo helpers ──────────────────────────────────────────────────────────────

_METERS_PER_DEG_LAT = 111_320.0


def _meters_per_deg_lon(lat: float) -> float:
    return _METERS_PER_DEG_LAT * math.cos(math.radians(lat))


def _distance_m(a: PathPoint, b: PathPoint) -> float:
    mid_lat = (a.lat + b.lat) / 2.0
    dx = (b.lon - a.lon) * _meters_per_deg_lon(mid_lat)
    dy = (b.lat - a.lat) * _METERS_PER_DEG_LAT
    return math.hypot(dx, dy)


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Accurate point-to-point distance in metres."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _closest_distance_to_path(img_lat: float, img_lon: float, path: list[PathPoint]) -> float:
    """
    Returns the minimum perpendicular distance (metres) from the image
    to any segment of the path.  Used for final strict filtering.
    """
    best = float("inf")
    for i in range(len(path) - 1):
        a = path[i]
        b = path[i + 1]
        mid_lat = (a.lat + b.lat) / 2.0
        mx = _meters_per_deg_lon(mid_lat)
        my = _METERS_PER_DEG_LAT

        ax, ay = a.lon * mx, a.lat * my
        bx, by = b.lon * mx, b.lat * my
        px, py = img_lon * mx, img_lat * my

        abx, aby = bx - ax, by - ay
        apx, apy = px - ax, py - ay
        denom = abx * abx + aby * aby

        if denom == 0:
            dist = math.hypot(apx, apy)
        else:
            t = max(0.0, min(1.0, (apx * abx + apy * aby) / denom))
            qx = ax + t * abx
            qy = ay + t * aby
            dist = math.hypot(px - qx, py - qy)

        if dist < best:
            best = dist

    return best


def _subsample_path(path: list[PathPoint], every_m: float) -> list[PathPoint]:
    """
    Return a list of probe points spaced ~every_m metres along the path.
    Always includes the first and last point.
    """
    if len(path) < 2:
        return path

    probes: list[PathPoint] = [path[0]]
    accumulated = 0.0

    for i in range(1, len(path)):
        seg_len = _distance_m(path[i - 1], path[i])
        accumulated += seg_len
        if accumulated >= every_m:
            probes.append(path[i])
            accumulated = 0.0

    if probes[-1] != path[-1]:
        probes.append(path[-1])

    return probes


def _bbox_for_point(lat: float, lon: float, radius_m: float):
    """Square bbox centred on (lat, lon) with half-side = radius_m."""
    lat_pad = radius_m / _METERS_PER_DEG_LAT
    lon_pad = radius_m / max(_meters_per_deg_lon(lat), 1.0)
    return lon - lon_pad, lat - lat_pad, lon + lon_pad, lat + lat_pad


async def _fetch_probe(provider: MapillaryProvider, probe: PathPoint, radius: float):
    redis = await get_redis()
    probe_key = f"mapillary:probe:{round(probe.lat,3)}:{round(probe.lon,3)}:{round(radius)}"

    if redis is not None:
        try:
            cached = await redis.get(probe_key)
            if cached:
                cached_items = json.loads(cached)
                return [
                    MapillaryImage(
                        id=item["id"],
                        lat=float(item["lat"]),
                        lon=float(item["lon"]),
                        captured_at=datetime.fromisoformat(item["captured_at"]) if item.get("captured_at") else None,
                        thumb_url=item.get("thumb_url"),
                        sequence_id=item.get("sequence_id"),
                    )
                    for item in cached_items
                ]
        except Exception:
            pass

    west, south, east, north = _bbox_for_point(probe.lat, probe.lon, radius)
    images = await asyncio.to_thread(
        provider.fetch_images_by_bbox, west, south, east, north, 50
    )
    if redis is not None:
        try:
            await redis.set(
                probe_key,
                json.dumps([
                    {
                        "id": image.id,
                        "lat": image.lat,
                        "lon": image.lon,
                        "captured_at": image.captured_at.isoformat() if image.captured_at else None,
                        "thumb_url": image.thumb_url,
                        "sequence_id": image.sequence_id,
                    }
                    for image in images
                ]),
                ex=86_400,
            )
        except Exception:
            pass
    return images


# ── Routes ───────────────────────────────────────────────────────────────────

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
    """
    Fetch Mapillary images along a road-snapped path.

    Strategy (replaces the old bbox-corridor approach):

    1. Subsample the path every `sample_every_meters` metres to get probe points.
    2. For each probe, fetch images inside a tiny square bbox of radius
       `search_radius_meters` (~15 m).  This is tight enough to exclude
       buildings on the other side of the pavement.
    3. Deduplicate across all probes.
    4. Final strict filter: keep only images whose perpendicular distance to
       the path is ≤ search_radius_meters (eliminates corner bleed).
    5. Sort by progress along the path, then thin so consecutive images are
       at least min_spacing_m apart.
    """
    try:
        provider = MapillaryProvider()
        path = req.path
        radius = req.search_radius_meters

        # 1. Subsample
        probes = _subsample_path(path, req.sample_every_meters)

        # 2. Fetch per probe concurrently
        results = await asyncio.gather(*[
            _fetch_probe(provider, probe, radius) for probe in probes
        ])

        seen: set[str] = set()
        candidates: list[MapillaryImage] = []
        strict: list[tuple[MapillaryImage, float]] = []
        filtered: list[MapillaryImage] = []

        for imgs in results:
            for img in imgs:
                if img.id not in seen:
                    seen.add(img.id)
                    candidates.append(img)

        if not candidates:
            print(f"[Mapillary] probes={len(probes)} candidates={len(candidates)} strict={len(strict)} final={len(filtered)}")
            return []

        # 3. Strict perpendicular-distance filter
        for img in candidates:
            dist = _closest_distance_to_path(img.lat, img.lon, path)
            if dist <= radius:
                strict.append((img, dist))

        if not strict:
            print(f"[Mapillary] probes={len(probes)} candidates={len(candidates)} strict={len(strict)} final={len(filtered)}")
            return []

        # 4. Compute progress along path for sorting
        cumulative = [0.0]
        for i in range(1, len(path)):
            cumulative.append(cumulative[i - 1] + _distance_m(path[i - 1], path[i]))
        total_length = cumulative[-1]

        def _progress(img: MapillaryImage) -> float:
            best_prog = 0.0
            best_dist = float("inf")
            for i in range(len(path) - 1):
                a = path[i]
                b = path[i + 1]
                mid_lat = (a.lat + b.lat) / 2.0
                mx = _meters_per_deg_lon(mid_lat)
                my = _METERS_PER_DEG_LAT
                ax, ay = a.lon * mx, a.lat * my
                bx, by = b.lon * mx, b.lat * my
                px, py = img.lon * mx, img.lat * my
                abx, aby = bx - ax, by - ay
                apx, apy = px - ax, py - ay
                denom = abx * abx + aby * aby
                if denom == 0:
                    t, d = 0.0, math.hypot(apx, apy)
                else:
                    t = max(0.0, min(1.0, (apx * abx + apy * aby) / denom))
                    qx, qy = ax + t * abx, ay + t * aby
                    d = math.hypot(px - qx, py - qy)
                seg_len = _distance_m(a, b)
                prog = cumulative[i] + t * seg_len
                if d < best_dist:
                    best_dist = d
                    best_prog = prog
            return best_prog

        scored = [(img, _progress(img)) for img, _ in strict]
        scored.sort(key=lambda x: x[1])

        # 5. Thin: keep images at least min_spacing apart
        min_spacing = max(8.0, total_length / 300)
        last_prog = -1e12
        for img, prog in scored:
            if prog - last_prog >= min_spacing:
                filtered.append(img)
                last_prog = prog

        print(f"[Mapillary] probes={len(probes)} candidates={len(candidates)} strict={len(strict)} final={len(filtered)}")

        response_items = [
            ImageResponse(
                id=img.id,
                lat=img.lat,
                lon=img.lon,
                thumb_url=img.thumb_url,
                captured_at=img.captured_at.isoformat() if img.captured_at else None,
            )
            for img in filtered
        ]
        return response_items

    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Mapillary path error: {e}")