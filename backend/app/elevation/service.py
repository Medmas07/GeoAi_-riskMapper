from __future__ import annotations

import logging

from app.core.config import settings
from app.elevation.catalog import (
    GEONAMES_DATASETS,
    OPENTOPODATA_DATASETS,
    OPENTOPOGRAPHY_DEMTYPES,
    ORS_ENDPOINTS,
    PROVIDERS,
)
from app.elevation.providers.base import ElevationProvider
from app.elevation.providers.geonames import GeoNamesProvider
from app.elevation.providers.openelevation import OpenElevationProvider
from app.elevation.providers.opentopodata import OpenTopoDataProvider
from app.elevation.providers.opentopography import OpenTopographyProvider
from app.elevation.providers.ors import ORSProvider
from app.elevation.utils import Coordinate, compute_profile, validate_line

logger = logging.getLogger("uvicorn.error")

ProviderName = str


class ElevationService:
    def __init__(self, providers: list[ElevationProvider] | None = None):
        self.providers = providers

    async def get_profile(
        self,
        line: list[Coordinate],
        *,
        provider: ProviderName | None = None,
        dataset: str | None = None,
        use_fallback: bool = True,
    ) -> dict:
        validated = validate_line(line)
        last_error: Exception | None = None

        providers = self.providers or _select_providers(
            provider=provider,
            dataset=dataset,
            use_fallback=use_fallback,
        )
        logger.info(
            "Elevation profile request: provider=%s dataset=%s fallback=%s chain=%s",
            provider or "default",
            dataset or "default",
            use_fallback,
            [p.name for p in providers],
        )

        for provider_impl in providers:
            try:
                points = await provider_impl.get_profile(validated)
                profile, total_distance = compute_profile(points)
                provider_name = getattr(provider_impl, "name", provider_impl.__class__.__name__)
                provider_dataset = _provider_dataset(provider_impl)
                logger.info(
                    "Elevation provider used: %s dataset=%s",
                    provider_name,
                    provider_dataset or "default",
                )
                return {
                    "provider": provider_name,
                    "dataset": provider_dataset,
                    "points": points,
                    "profile": profile,
                    "total_distance": total_distance,
                }
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                message = str(exc) or exc.__class__.__name__
                logger.warning("Elevation provider '%s' failed: %s", provider_impl.name, message)

        raise RuntimeError("All providers failed") from last_error


def _provider_dataset(provider: ElevationProvider) -> str | None:
    if hasattr(provider, "demtype"):
        return str(getattr(provider, "demtype"))
    if hasattr(provider, "dataset"):
        return str(getattr(provider, "dataset"))
    if hasattr(provider, "datasets"):
        datasets = getattr(provider, "datasets")
        if isinstance(datasets, tuple):
            return ",".join(str(x) for x in datasets)
    return None


def _default_provider_order() -> list[ElevationProvider]:
    return [
        ORSProvider(),
        OpenTopographyProvider(demtype=settings.ELEVATION_OPENTOPOGRAPHY_DEMTYPE),
        OpenTopoDataProvider(dataset=settings.ELEVATION_OPENTOPODATA_DATASET),
        OpenElevationProvider(),
        GeoNamesProvider(),
    ]


def _build_provider(name: ProviderName, dataset: str | None) -> ElevationProvider:
    normalized = name.lower()
    if normalized == "ors":
        return ORSProvider()
    if normalized == "opentopography":
        demtype = dataset or settings.ELEVATION_OPENTOPOGRAPHY_DEMTYPE
        return OpenTopographyProvider(demtype=demtype)
    if normalized == "opentopodata":
        ds = dataset or settings.ELEVATION_OPENTOPODATA_DATASET
        return OpenTopoDataProvider(dataset=ds)
    if normalized == "openelevation":
        return OpenElevationProvider()
    if normalized == "geonames":
        return GeoNamesProvider(dataset=dataset)
    raise ValueError(f"Unknown provider '{name}'")


def _select_providers(
    *,
    provider: ProviderName | None,
    dataset: str | None,
    use_fallback: bool,
) -> list[ElevationProvider]:
    if provider:
        primary = _build_provider(provider, dataset)
        if not use_fallback:
            return [primary]

        fallbacks = _default_provider_order()
        seen = {primary.name}
        merged = [primary]
        for p in fallbacks:
            if p.name in seen:
                continue
            merged.append(p)
            seen.add(p.name)
        return merged

    defaults = _default_provider_order()
    if use_fallback:
        return defaults
    return defaults[:1]


def get_profile_options() -> dict:
    return {
        "providers": PROVIDERS,
        "defaults": {
            "chain": ["ors", "opentopography", "opentopodata", "openelevation", "geonames"],
            "opentopodata_dataset": settings.ELEVATION_OPENTOPODATA_DATASET,
            "opentopography_demtype": settings.ELEVATION_OPENTOPOGRAPHY_DEMTYPE,
        },
        "datasets": {
            "geonames": GEONAMES_DATASETS,
            "opentopodata": OPENTOPODATA_DATASETS,
            "opentopography": OPENTOPOGRAPHY_DEMTYPES,
        },
        "ors_endpoints_catalog": ORS_ENDPOINTS,
        "notes": [
            "This catalog keeps all declared datasets/endpoints accessible for selection.",
            "this part may used later not now",
            "Only elevation-related providers are used in /profile today.",
        ],
    }
