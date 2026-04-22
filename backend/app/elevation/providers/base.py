from __future__ import annotations

from abc import ABC, abstractmethod
from time import monotonic
import httpx

from app.elevation.utils import ElevationPoint, Coordinate, resample_line, validate_line


class ElevationProvider(ABC):
    name = "base"
    timeout_budget_s = 3.0
    retries = 1

    @abstractmethod
    async def get_profile(self, line: list[Coordinate]) -> list[ElevationPoint]:
        """
        Return normalized points:
        [{"lat": ..., "lon": ..., "elevation": ...}, ...]
        """

    async def _request_json(
        self,
        client: httpx.AsyncClient,
        method: str,
        url: str,
        *,
        deadline: float,
        **kwargs,
    ) -> dict:
        """
        Retry within provider budget.
        Hard limit: `timeout_budget_s` total per provider.
        """
        last_error: Exception | None = None

        for _ in range(self.retries + 1):
            remaining = deadline - monotonic()
            if remaining <= 0:
                break

            timeout = min(1.5, remaining)
            try:
                response = await client.request(method, url, timeout=timeout, **kwargs)
                response.raise_for_status()
                return response.json()
            except Exception as exc:  # noqa: BLE001
                last_error = exc

        if last_error is not None:
            raise last_error
        raise TimeoutError(f"{self.name} request timed out")

    async def _request_text(
        self,
        client: httpx.AsyncClient,
        method: str,
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
                response = await client.request(method, url, timeout=timeout, **kwargs)
                response.raise_for_status()
                return response.text
            except Exception as exc:  # noqa: BLE001
                last_error = exc

        if last_error is not None:
            raise last_error
        raise TimeoutError(f"{self.name} request timed out")


class PointElevationProvider(ElevationProvider):
    """
    Base for providers that only support point elevations.
    Enforces 10m resampling.
    """

    resample_step_m = 10.0

    async def get_profile(self, line: list[Coordinate]) -> list[ElevationPoint]:
        clean = validate_line(line)
        sampled = resample_line(clean, step_m=self.resample_step_m)
        elevations = await self._fetch_points(sampled)
        if len(elevations) != len(sampled):
            raise RuntimeError(f"{self.name} returned mismatched elevation count")

        points: list[ElevationPoint] = []
        for (lon, lat), elevation in zip(sampled, elevations):
            points.append({"lat": float(lat), "lon": float(lon), "elevation": float(elevation)})
        return points

    @abstractmethod
    async def _fetch_points(self, sampled_line: list[Coordinate]) -> list[float]:
        """Return elevations for sampled points in same order."""
