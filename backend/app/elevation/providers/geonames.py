from __future__ import annotations

from time import monotonic
import httpx

from app.core.config import settings
from app.elevation.catalog import GEONAMES_DATASETS
from app.elevation.providers.base import PointElevationProvider
from app.elevation.utils import Coordinate


class GeoNamesProvider(PointElevationProvider):
    name = "geonames"
    base_url = "http://api.geonames.org"
    default_datasets = ("srtm1", "srtm3", "astergdem", "gtopo30")

    def __init__(self, dataset: str | None = None):
        # If dataset is provided, force this dataset only.
        if dataset:
            normalized = dataset.strip().lower()
            if normalized not in GEONAMES_DATASETS:
                raise ValueError(
                    f"Unsupported GeoNames dataset '{dataset}'. "
                    f"Allowed: {', '.join(GEONAMES_DATASETS.keys())}"
                )
            self.datasets = (normalized,)
        else:
            self.datasets = self.default_datasets

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
                "GET",
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
