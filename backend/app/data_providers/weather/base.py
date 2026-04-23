from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass
class WeatherRecord:
    timestamp: datetime
    rainfall_mm: float
    temperature_c: float
    humidity_pct: float
    wind_speed_ms: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "rainfall_mm": self.rainfall_mm,
            "temperature_c": self.temperature_c,
            "humidity_pct": self.humidity_pct,
            "wind_speed_ms": self.wind_speed_ms,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WeatherRecord":
        return cls(
            timestamp=datetime.fromisoformat(data["timestamp"]),
            rainfall_mm=float(data.get("rainfall_mm", 0.0)),
            temperature_c=float(data.get("temperature_c", 0.0)),
            humidity_pct=float(data.get("humidity_pct", 0.0)),
            wind_speed_ms=float(data.get("wind_speed_ms", 0.0)),
        )


@dataclass
class WeatherSummary:
    records: list[WeatherRecord]
    total_rainfall_mm: float
    peak_intensity_mm_hr: float
    mean_temp_c: float
    provider: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "records": [record.to_dict() for record in self.records],
            "total_rainfall_mm": self.total_rainfall_mm,
            "peak_intensity_mm_hr": self.peak_intensity_mm_hr,
            "mean_temp_c": self.mean_temp_c,
            "provider": self.provider,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WeatherSummary":
        return cls(
            records=[WeatherRecord.from_dict(item) for item in data.get("records", [])],
            total_rainfall_mm=float(data.get("total_rainfall_mm", 0.0)),
            peak_intensity_mm_hr=float(data.get("peak_intensity_mm_hr", 0.0)),
            mean_temp_c=float(data.get("mean_temp_c", 0.0)),
            provider=str(data.get("provider", "open_meteo")),
        )


class WeatherProvider(ABC):
    @abstractmethod
    async def fetch_historical(
        self, lat: float, lon: float, days_back: int
    ) -> WeatherSummary:
        ...

    @abstractmethod
    async def fetch_current(self, lat: float, lon: float) -> WeatherRecord:
        ...
