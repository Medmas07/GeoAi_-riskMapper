import numpy as np
import httpx
from app.data_providers.dem.base import DEMProvider, DEMData
from app.core.config import settings

class SRTMProvider(DEMProvider):
    """
    Fetches SRTM 30m DEM via OpenTopography API (free tier, no key required).
    Returns a numpy elevation array.
    """

    BASE = "https://portal.opentopography.org/API/globaldem"

    def fetch(self, west: float, south: float, east: float, north: float) -> DEMData:
        params = {
            "demtype": "SRTMGL1",  # 30m resolution
            "west": west,
            "south": south,
            "east": east,
            "north": north,
            "outputFormat": "AAIGrid",  # ASCII Grid — easy to parse
            "API_Key": settings.OPENTOPOGRAPHY_API_KEY,  
        }

        with httpx.Client(timeout=60) as client:
            r = client.get(self.BASE, params=params)
            r.raise_for_status()
            text = r.text

        elevation = self._parse_asc(text)

        return DEMData(
            elevation=elevation,
            resolution_m=30.0,
            bbox=[west, south, east, north],
            provider="srtm",
        )

    def _parse_asc(self, text: str) -> np.ndarray:
        lines = text.strip().split("\n")
        header_done = False
        rows = []
        ncols = nrows = nodata = None

        for line in lines:
            if not header_done:
                parts = line.lower().split()
                if parts[0] == "ncols":
                    ncols = int(parts[1])
                elif parts[0] == "nrows":
                    nrows = int(parts[1])
                elif parts[0] == "nodata_value":
                    nodata = float(parts[1])
                elif len(parts) > 0 and parts[0].replace(".", "").replace("-", "").isdigit():
                    header_done = True
                    rows.append([float(v) for v in parts])
            else:
                rows.append([float(v) for v in line.split()])

        arr = np.array(rows)
        if nodata is not None:
            arr[arr == nodata] = np.nan
        return arr
