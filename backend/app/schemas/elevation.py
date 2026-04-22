from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class ProfileRequest(BaseModel):
    line: list[list[float]] = Field(..., description="LineString coordinates [[lon, lat], ...]")

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
    points: list[ElevationPoint]
    profile: list[ProfileSample]
    total_distance: float

