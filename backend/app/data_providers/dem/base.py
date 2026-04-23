from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any
import numpy as np


@dataclass
class DEMData:
    elevation: np.ndarray     # 2D elevation grid (meters)
    resolution_m: float
    bbox: list[float]         # [west, south, east, north]
    provider: str
    crs: str = "EPSG:4326"

    def to_dict(self) -> dict[str, Any]:
        return {
            "elevation": self.elevation.tolist(),
            "resolution_m": self.resolution_m,
            "bbox": self.bbox,
            "provider": self.provider,
            "crs": self.crs,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DEMData":
        return cls(
            elevation=np.array(data.get("elevation", []), dtype=float),
            resolution_m=float(data.get("resolution_m", 0.0)),
            bbox=list(data.get("bbox", [])),
            provider=str(data.get("provider", "srtm")),
            crs=str(data.get("crs", "EPSG:4326")),
        )


class DEMProvider(ABC):
    @abstractmethod
    def fetch(self, west: float, south: float, east: float, north: float) -> DEMData:
        ...
