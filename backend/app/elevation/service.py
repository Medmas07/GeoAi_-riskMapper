from __future__ import annotations

import logging

from app.elevation.providers.base import ElevationProvider
from app.elevation.providers.geonames import GeoNamesProvider
from app.elevation.providers.openelevation import OpenElevationProvider
from app.elevation.providers.opentopodata import OpenTopoDataProvider
from app.elevation.providers.ors import ORSProvider
from app.elevation.utils import Coordinate, compute_profile, validate_line

logger = logging.getLogger(__name__)


class ElevationService:
    def __init__(self, providers: list[ElevationProvider] | None = None):
        self.providers = providers or [
            ORSProvider(),
            OpenTopoDataProvider(),
            OpenElevationProvider(),
            GeoNamesProvider(),
        ]

    async def get_profile(self, line: list[Coordinate]) -> dict:
        validated = validate_line(line)
        last_error: Exception | None = None

        for provider in self.providers:
            try:
                points = await provider.get_profile(validated)
                profile, total_distance = compute_profile(points)
                logger.info("Elevation provider used: %s", provider.name)
                return {
                    "provider": provider.name,
                    "points": points,
                    "profile": profile,
                    "total_distance": total_distance,
                }
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                logger.warning("Elevation provider '%s' failed: %s", provider.name, exc)

        raise RuntimeError("All providers failed") from last_error

