from pydantic_settings import BaseSettings
from typing import Literal


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
        env_file = ".env"
        case_sensitive = True


settings = Settings()
