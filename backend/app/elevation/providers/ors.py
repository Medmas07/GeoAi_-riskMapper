from __future__ import annotations

from time import monotonic
import httpx

from app.core.config import settings
from app.elevation.providers.base import ElevationProvider
from app.elevation.utils import ElevationPoint, Coordinate, validate_line


class ORSProvider(ElevationProvider):
    name = "openrouteservice"
    endpoint = "https://api.openrouteservice.org/elevation/line"

    async def get_profile(self, line: list[Coordinate]) -> list[ElevationPoint]:
        if not settings.ORS_API_KEY:
            raise RuntimeError("ORS_API_KEY is not configured")

        coordinates = validate_line(line)
        deadline = monotonic() + self.timeout_budget_s

        payload = {
            "format_in": "geojson",
            "geometry": {
                "type": "LineString",
                "coordinates": coordinates,
            },
        }
        headers = {
            "Authorization": settings.ORS_API_KEY,
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient() as client:
            data = await self._request_json(
                client,
                "POST",
                self.endpoint,
                deadline=deadline,
                json=payload,
                headers=headers,
            )

        coords = _extract_coords(data)
        points: list[ElevationPoint] = []
        for coord in coords:
            if len(coord) < 3:
                raise RuntimeError("ORS coordinate missing elevation")
            lon, lat, elevation = float(coord[0]), float(coord[1]), float(coord[2])
            points.append({"lat": lat, "lon": lon, "elevation": elevation})

        if len(points) < 2:
            raise RuntimeError("ORS returned insufficient points")

        return points


def _extract_coords(data: dict) -> list[list[float]]:
    if isinstance(data.get("geometry"), dict):
        coords = data["geometry"].get("coordinates")
        if isinstance(coords, list):
            return coords

    if isinstance(data.get("coordinates"), list):
        return data["coordinates"]

    if isinstance(data.get("features"), list) and data["features"]:
        feature = data["features"][0]
        geometry = feature.get("geometry", {})
        coords = geometry.get("coordinates")
        if isinstance(coords, list):
            return coords

    raise RuntimeError("Unexpected ORS response format")

