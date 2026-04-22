from __future__ import annotations

from app.elevation.catalog import PROVIDERS
from pydantic import BaseModel, Field, field_validator, model_validator


class ProfileRequest(BaseModel):
    line: list[list[float]] = Field(..., description="LineString coordinates [[lon, lat], ...]")
    provider: str | None = Field(
        default=None,
        description="Force provider. See GET /profile/options for full catalog.",
    )
    dataset: str | None = Field(
        default=None,
        description="Optional provider dataset/demtype. See GET /profile/options for full catalog.",
    )
    use_fallback: bool = Field(
        default=True,
        description="If false, only the selected/default provider is used",
    )

    @field_validator("line")
    @classmethod
    def validate_line(cls, value: list[list[float]]) -> list[list[float]]:
        if len(value) < 2:
            raise ValueError("line must contain at least 2 coordinates")
        for coord in value:
            if len(coord) != 2:
                raise ValueError("each coordinate must be [lon, lat]")
            lon, lat = float(coord[0]), float(coord[1])
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError(f"invalid coordinate [{lon}, {lat}]")
        return value

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized not in PROVIDERS:
            raise ValueError(f"provider must be one of: {', '.join(PROVIDERS)}")
        return normalized

    @model_validator(mode="after")
    def validate_provider_dataset(self) -> "ProfileRequest":
        if self.dataset and not self.provider:
            raise ValueError("provider must be set when dataset is provided")
        return self


class ElevationPoint(BaseModel):
    lat: float
    lon: float
    elevation: float


class ProfileSample(BaseModel):
    lat: float
    lon: float
    distance: float
    elevation: float
    slope: float


class ProfileResponse(BaseModel):
    provider: str
    dataset: str | None = None
    points: list[ElevationPoint]
    profile: list[ProfileSample]
    total_distance: float
