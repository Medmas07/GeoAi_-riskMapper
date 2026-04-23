import httpx
from dataclasses import dataclass
from datetime import datetime
import logging
from typing import Optional
from app.core.config import settings

logger = logging.getLogger("uvicorn.error")


@dataclass
class MapillaryImage:
    id: str
    lat: float
    lon: float
    captured_at: Optional[datetime]
    thumb_url: Optional[str]
    sequence_id: Optional[str]


class MapillaryProvider:
    """
    Fetches image metadata from Mapillary Graph API.
    We NEVER download or store image files — only IDs and coordinates.
    """

    BASE = settings.MAPILLARY_API_BASE
    FIELDS = "id,geometry,captured_at,thumb_1024_url,thumb_256_url,sequence"

    def __init__(self):
        self.token = settings.MAPILLARY_ACCESS_TOKEN

    def _headers(self) -> dict:
        return {"Authorization": f"OAuth {self.token}"}

    @staticmethod
    def _parse_captured_at(value) -> Optional[datetime]:
        if value is None:
            return None

        # Mapillary can return ISO string or numeric epoch (ms/s).
        if isinstance(value, str):
            iso = value.replace("Z", "+00:00")
            try:
                return datetime.fromisoformat(iso)
            except ValueError:
                return None

        if isinstance(value, (int, float)):
            ts = float(value)
            if ts > 1e11:  # likely milliseconds
                ts /= 1000.0
            try:
                return datetime.fromtimestamp(ts)
            except (OSError, OverflowError, ValueError):
                return None

        return None

    def fetch_images_by_bbox(
    self,
    west: float,
    south: float,
    east: float,
    north: float,
    limit: int = 100,
) -> list[MapillaryImage]:
        if not self.token:
            raise RuntimeError("MAPILLARY_ACCESS_TOKEN is not configured")

        MAX_DEGREES = 0.04  # stay under 0.010 sq deg limit
        results: list[MapillaryImage] = []
        seen_ids: set[str] = set()
        tile_errors: list[str] = []

        # Split bbox into tiles if too large
        lon_steps = [west + i * MAX_DEGREES for i in range(int((east - west) / MAX_DEGREES) + 1)]
        lat_steps = [south + i * MAX_DEGREES for i in range(int((north - south) / MAX_DEGREES) + 1)]

        # trust_env=False prevents broken local proxy env vars from hijacking calls.
        with httpx.Client(timeout=30, trust_env=False) as client:
            for i in range(len(lon_steps)):
                for j in range(len(lat_steps)):
                    tile_west = lon_steps[i]
                    tile_east = min(tile_west + MAX_DEGREES, east)
                    tile_south = lat_steps[j]
                    tile_north = min(tile_south + MAX_DEGREES, north)

                    params = {
                        "fields": self.FIELDS,
                        "bbox": f"{tile_west},{tile_south},{tile_east},{tile_north}",
                        "limit": limit,
                    }
                    try:
                        r = client.get(
                            f"{self.BASE}/images",
                            params=params,
                            headers=self._headers(),
                        )
                        r.raise_for_status()
                        data = r.json()


                        for feat in data.get("data", []):
                            image_id = str(feat.get("id", ""))
                            geometry = feat.get("geometry") or {}
                            coords = geometry.get("coordinates") or []
                            if not image_id or len(coords) < 2:
                                continue
                            if image_id in seen_ids:
                                continue

                            seen_ids.add(image_id)
                            results.append(
                                MapillaryImage(
                                    id=image_id,
                                    lon=float(coords[0]),
                                    lat=float(coords[1]),
                                    captured_at=self._parse_captured_at(feat.get("captured_at")),
                                    thumb_url=feat.get("thumb_1024_url"),
                                    sequence_id=feat.get("sequence"),
                                )
                            )
                    except Exception as e:  # noqa: BLE001
                        tile_errors.append(str(e))
                        logger.warning("Mapillary tile request failed: %s", e)
                        continue  # keep partial results if available

        if not results and tile_errors:
            # Promote full failure when every tile failed (instead of silent empty list).
            raise RuntimeError(f"Mapillary fetch failed: {tile_errors[0]}")

        return results
