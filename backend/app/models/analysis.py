import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from geoalchemy2 import Geometry
from app.core.database import Base
import enum


class AnalysisStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class Project(Base):
    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    description = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)


class AreaOfInterest(Base):
    __tablename__ = "areas_of_interest"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"))
    geometry = Column(Geometry("POLYGON", srid=4326), nullable=False)
    bbox = Column(JSONB)  # {west, south, east, north}
    created_at = Column(DateTime, default=datetime.utcnow)


class WeatherData(Base):
    __tablename__ = "weather_data"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    aoi_id = Column(UUID(as_uuid=True), ForeignKey("areas_of_interest.id"))
    provider = Column(String, nullable=False)
    timestamp = Column(DateTime, nullable=False)
    rainfall_mm = Column(Float)
    temperature_c = Column(Float)
    humidity_pct = Column(Float)
    raw = Column(JSONB)


class TerrainData(Base):
    __tablename__ = "terrain_data"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    aoi_id = Column(UUID(as_uuid=True), ForeignKey("areas_of_interest.id"))
    provider = Column(String, nullable=False)
    resolution_m = Column(Float)
    stats = Column(JSONB)  # {min_elev, max_elev, mean_slope, ...}
    raster_path = Column(String)  # local path or object storage key


class ImageMetadata(Base):
    __tablename__ = "image_metadata"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    aoi_id = Column(UUID(as_uuid=True), ForeignKey("areas_of_interest.id"))
    mapillary_id = Column(String, unique=True, nullable=False)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    captured_at = Column(DateTime)
    cv_features = Column(JSONB)  # {vegetation_score, shadow_score, surface_type, ...}


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    aoi_id = Column(UUID(as_uuid=True), ForeignKey("areas_of_interest.id"))
    status = Column(SAEnum(AnalysisStatus, name="analysis_status"), default=AnalysisStatus.pending)    
    simulation_engine = Column(String, default="null")
    config_snapshot = Column(JSONB)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime)
    error = Column(String)


class RiskResult(Base):
    __tablename__ = "risk_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id = Column(UUID(as_uuid=True), ForeignKey("analysis_runs.id"))
    risk_type = Column(String, nullable=False)  # "flood" | "heat"
    geometry = Column(Geometry("POLYGON", srid=4326))
    score = Column(Float, nullable=False)  # 0.0 - 1.0
    components = Column(JSONB)  # breakdown of contributing factors
    created_at = Column(DateTime, default=datetime.utcnow)
