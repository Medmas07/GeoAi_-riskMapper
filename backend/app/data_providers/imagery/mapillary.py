import httpx
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from app.core.config import settings


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
    FIELDS = "id,geometry,captured_at,thumb_1024_url,sequence"

    def __init__(self):
        self.token = settings.MAPILLARY_ACCESS_TOKEN

    def _headers(self) -> dict:
        return {"Authorization": f"OAuth {self.token}"}

    def fetch_images_by_bbox(
    self,
    west: float,
    south: float,
    east: float,
    north: float,
    limit: int = 100,
) -> list[MapillaryImage]:
        MAX_DEGREES = 0.04  # stay under 0.010 sq deg limit
        results = []

        # Split bbox into tiles if too large
        lon_steps = [west + i * MAX_DEGREES for i in range(int((east - west) / MAX_DEGREES) + 1)]
        lat_steps = [south + i * MAX_DEGREES for i in range(int((north - south) / MAX_DEGREES) + 1)]

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
                    with httpx.Client(timeout=30) as client:
                        r = client.get(
                            f"{self.BASE}/images",
                            params=params,
                            headers=self._headers(),
                        )
                        r.raise_for_status()
                        data = r.json()

                    for feat in data.get("data", []):
                        coords = feat["geometry"]["coordinates"]
                        captured = feat.get("captured_at")
                        results.append(
                            MapillaryImage(
                                id=feat["id"],
                                lon=coords[0],
                                lat=coords[1],
                                captured_at=datetime.fromtimestamp(captured / 1000) if captured else None,
                                thumb_url=feat.get("thumb_1024_url"),
                                sequence_id=feat.get("sequence"),
                            )
                        )
                except Exception as e:
                    print(f"Mapillary tile error: {e}")
                    continue  # skip failed tiles, don't crash whole pipeline

        return results
