from __future__ import annotations

# this part may used later not now
# Full OpenRouteService endpoint catalog for discoverability/config tooling.
ORS_ENDPOINTS = [
    "Directions V2",
    "Export V2",
    "Isochrones V2",
    "Matrix V2",
    "Snap V2",
    "Elevation Line",
    "Elevation Point",
    "Geocode Autocomplete",
    "Geocode Reverse",
    "Geocode Search",
    "Optimization",
    "POIs",
]

# this part may used later not now
# GeoNames elevation datasets (all available from the user-provided list).
GEONAMES_DATASETS = {
    "srtm1": {
        "resolution": "30m",
        "endpoint": "http://api.geonames.org/srtm1",
        "no_data_value": -32768,
    },
    "srtm3": {
        "resolution": "90m",
        "endpoint": "http://api.geonames.org/srtm3",
        "no_data_value": -32768,
    },
    "astergdem": {
        "resolution": "30m",
        "endpoint": "http://api.geonames.org/astergdem",
        "no_data_value": -32768,
    },
    "gtopo30": {
        "resolution": "1km",
        "endpoint": "http://api.geonames.org/gtopo30",
        "no_data_value": -9999,
    },
}

# this part may used later not now
# OpenTopoData dataset catalog including all options requested.
OPENTOPODATA_DATASETS = {
    "srtm30m": {"label": "SRTM (30m)", "slug": "srtm30m"},
    "srtm90m": {"label": "SRTM (90m)", "slug": "srtm90m"},
    "aster30m": {"label": "ASTER (30m)", "slug": "aster30m"},
    "etopo1": {"label": "ETOPO1", "slug": "etopo1"},
    "eudem25m": {"label": "EU-DEM", "slug": "eudem25m"},
    "mapzen": {"label": "Mapzen", "slug": "mapzen"},
    "ned10m": {"label": "NED", "slug": "ned10m"},
    "nzdem8m": {"label": "NZ DEM", "slug": "nzdem8m"},
    "emod2018": {"label": "EMOD bathymetry", "slug": "emod2018"},
    "gebco2020": {"label": "GEBCO bathymetry", "slug": "gebco2020"},
    "bkg200m": {"label": "BKG", "slug": "bkg200m"},
    "swisstopo": {"label": "Swisstopo", "slug": "swisstopo"},
}

OPENTOPODATA_ALIASES = {
    "srtm30": "srtm30m",
    "srtm90": "srtm90m",
    "aster": "aster30m",
    "aster(30m)": "aster30m",
    "eudem": "eudem25m",
    "eu-dem": "eudem25m",
    "ned": "ned10m",
    "nzdem": "nzdem8m",
    "emod": "emod2018",
    "gebco": "gebco2020",
    "bkg": "bkg200m",
}

OPENTOPOGRAPHY_DEMTYPES = {
    "SRTMGL1": "SRTM 30m Global",
    "SRTMGL3": "SRTM 90m Global",
    "AW3D30": "ALOS World 3D 30m",
    "COP30": "Copernicus 30m",
}

PROVIDERS = ["ors", "opentopography", "opentopodata", "openelevation", "geonames"]


def normalize_opentopodata_dataset(value: str) -> str:
    raw = value.strip().lower().replace(" ", "")
    if raw in OPENTOPODATA_DATASETS:
        return OPENTOPODATA_DATASETS[raw]["slug"]
    if raw in OPENTOPODATA_ALIASES:
        return OPENTOPODATA_ALIASES[raw]
    # keep arbitrary dataset names accessible for future custom datasets
    return raw

