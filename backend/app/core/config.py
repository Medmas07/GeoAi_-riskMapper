from pydantic_settings import BaseSettings
from typing import Literal
from pathlib import Path


ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    # App
    APP_NAME: str = "GeoAI Risk Engine"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://user:pass@localhost:5432/geoai"

    # Supabase Auth
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_KEY: str = ""

    # Mapillary
    MAPILLARY_ACCESS_TOKEN: str = ""
    MAPILLARY_API_BASE: str = "https://graph.mapillary.com"

    # Elevation providers
    ORS_API_KEY: str = ""
    GEONAMES_USERNAME: str = ""
    ELEVATION_OPENTOPODATA_DATASET: str = "srtm90m"
    ELEVATION_OPENTOPOGRAPHY_DEMTYPE: str = "SRTMGL1"

    # Weather
    WEATHER_PROVIDER: Literal["open_meteo", "openweather"] = "open_meteo"
    OPENWEATHER_API_KEY: str = ""

    # DEM
    DEM_PROVIDER: Literal["srtm", "copernicus"] = "srtm"
    COPERNICUS_API_KEY: str = ""

    # Simulation engine
    SIMULATION_ENGINE: Literal["hecras", "null"] = "null"
    HECRAS_MCP_URL: str = ""

    # CV Model
    CV_MODEL: Literal["clip", "resnet", "mock"] = "clip"
    OPENTOPOGRAPHY_API_KEY: str = ""

    class Config:
        env_file = str(ENV_FILE)
        case_sensitive = True
        # Allow branch-specific env vars that may not be used by this branch.
        extra = "ignore"

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls,
        init_settings,
        env_settings,
        dotenv_settings,
        file_secret_settings,
    ):
        # Prefer project-local .env values over machine-wide env vars
        # to avoid collisions (e.g. system DEBUG=release).
        return init_settings, dotenv_settings, env_settings, file_secret_settings


settings = Settings()
