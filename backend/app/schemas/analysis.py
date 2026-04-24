from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID
from datetime import datetime


class BBox(BaseModel):
    west: float = Field(..., ge=-180, le=180)
    south: float = Field(..., ge=-90, le=90)
    east: float = Field(..., ge=-180, le=180)
    north: float = Field(..., ge=-90, le=90)

    def to_list(self) -> list[float]:
        return [self.west, self.south, self.east, self.north]


class AnalysisRequest(BaseModel):
    bbox: BBox
    project_id: Optional[UUID] = None
    simulation_engine: Optional[str] = None  # overrides config default
    weather_days_back: int = Field(7, ge=1, le=90)


class AnalysisStatus(BaseModel):
    run_id: UUID
    status: str
    created_at: datetime
    completed_at: Optional[datetime] = None
    error: Optional[str] = None


class RiskLayer(BaseModel):
    risk_type: str
    score: float
    geometry: dict  # GeoJSON
    components: dict


class ImagePoint(BaseModel):
    id: str
    url: str
    lat: float
    lon: float


class AnalysisResult(BaseModel):
    run_id: UUID
    status: str
    flood_layers: list[RiskLayer] = []
    heat_layers: list[RiskLayer] = []
    images: list[ImagePoint] = Field(default_factory=list)
    image_count: int = 0
    simulation_engine_used: str = "null"
