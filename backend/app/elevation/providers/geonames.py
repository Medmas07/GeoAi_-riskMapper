from __future__ import annotations

from time import monotonic
import httpx

from app.core.config import settings
from app.elevation.providers.base import PointElevationProvider
from app.elevation.utils import Coordinate


class GeoNamesProvider(PointElevationProvider):
    name = "geonames"
    base_url = "http://api.geonames.org"
    datasets = ("srtm1", "srtm3", "astergdem")

    async def _fetch_points(self, sampled_line: list[Coordinate]) -> list[float]:
        if not settings.GEONAMES_USERNAME:
            raise RuntimeError("GEONAMES_USERNAME is not configured")

        deadline = monotonic() + self.timeout_budget_s
        elevations: list[float] = []

        async with httpx.AsyncClient() as client:
            for lon, lat in sampled_line:
                elevation = await self._fetch_point(client, lat, lon, deadline)
                elevations.append(elevation)

        return elevations

    async def _fetch_point(
        self,
        client: httpx.AsyncClient,
        lat: float,
        lon: float,
        deadline: float,
    ) -> float:
        for dataset in self.datasets:
            url = f"{self.base_url}/{dataset}"
            data_text = await self._request_text(
                client,
                url,
                deadline=deadline,
                params={
                    "lat": lat,
                    "lng": lon,
                    "username": settings.GEONAMES_USERNAME,
                },
            )

            elevation = _parse_geonames_elevation(data_text)
            if elevation is not None:
                return elevation

        raise RuntimeError(f"GeoNames has no elevation for ({lat}, {lon})")

    async def _request_text(
        self,
        client: httpx.AsyncClient,
        url: str,
        *,
        deadline: float,
        **kwargs,
    ) -> str:
        last_error: Exception | None = None
        for _ in range(self.retries + 1):
            remaining = deadline - monotonic()
            if remaining <= 0:
                break

            timeout = min(1.5, remaining)
            try:
                response = await client.get(url, timeout=timeout, **kwargs)
                response.raise_for_status()
                return response.text.strip()
            except Exception as exc:  # noqa: BLE001
                last_error = exc

        if last_error is not None:
            raise last_error
        raise TimeoutError("GeoNames request timed out")


def _parse_geonames_elevation(text: str) -> float | None:
    # GeoNames can return plain integer values or textual errors.
    try:
        value = float(text)
    except ValueError:
        return None

    # Sentinel values for no-data.
    if value in (-32768.0, -9999.0):
        return None
    return value

