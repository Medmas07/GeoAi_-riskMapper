from __future__ import annotations

from time import monotonic
import httpx

from app.elevation.providers.base import PointElevationProvider
from app.elevation.utils import Coordinate


class OpenElevationProvider(PointElevationProvider):
    name = "open-elevation"
    endpoint = "https://api.open-elevation.com/api/v1/lookup"
    chunk_size = 100

    async def _fetch_points(self, sampled_line: list[Coordinate]) -> list[float]:
        deadline = monotonic() + self.timeout_budget_s
        elevations: list[float] = []

        async with httpx.AsyncClient() as client:
            for i in range(0, len(sampled_line), self.chunk_size):
                chunk = sampled_line[i : i + self.chunk_size]
                locations = "|".join(f"{lat},{lon}" for lon, lat in chunk)
                data = await self._request_json(
                    client,
                    "GET",
                    self.endpoint,
                    deadline=deadline,
                    params={"locations": locations},
                )

                results = data.get("results", [])
                if len(results) != len(chunk):
                    raise RuntimeError("Open-Elevation result length mismatch")

                for item in results:
                    elevation = item.get("elevation")
                    if elevation is None:
                        raise RuntimeError("Open-Elevation returned null elevation")
                    elevations.append(float(elevation))

        return elevations

