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

    def _fallback_dem(
        self, west: float, south: float, east: float, north: float
    ) -> DEMData:
        rows, cols = 80, 80
        yy, xx = np.mgrid[0:rows, 0:cols]

        # Smooth, non-flat synthetic surface to keep terrain derivatives stable
        base = 40.0
        planar = (xx / max(cols - 1, 1)) * 8.0 + (yy / max(rows - 1, 1)) * 6.0
        undulation = 2.0 * np.sin(xx / 7.0) * np.cos(yy / 9.0)
        elevation = base + planar + undulation

        mid_lat = (south + north) / 2.0
        meters_per_deg_lon = 111_320.0 * np.cos(np.radians(mid_lat))
        width_m = max((east - west) * max(meters_per_deg_lon, 1.0), 1.0)
        resolution_m = width_m / cols

        return DEMData(
            elevation=elevation.astype(float),
            resolution_m=float(resolution_m),
            bbox=[west, south, east, north],
            provider="srtm-fallback",
        )

    def fetch(self, west: float, south: float, east: float, north: float) -> DEMData:
        # Enforce minimum bounding box size for OpenTopography (~0.05 degrees)
        width = east - west
        height = north - south
        
        min_size = 0.06
        
        if width < min_size:
            pad = (min_size - width) / 2
            west -= pad
            east += pad
            
        if height < min_size:
            pad_h = (min_size - height) / 2
            south -= pad_h
            north += pad_h

        params = {
            "demtype": "SRTMGL3",  # 90m resolution globally free without key, SRTMGL1 requires key and quota
            "west": west,
            "south": south,
            "east": east,
            "north": north,
            "outputFormat": "AAIGrid",  # ASCII Grid — easy to parse
        }
        
        # Only add API key if explicitly provided
        if settings.OPENTOPOGRAPHY_API_KEY:
            params["API_Key"] = settings.OPENTOPOGRAPHY_API_KEY
            params["demtype"] = "SRTMGL1" # Upgrade to 30m if key exists

        try:
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
        except (httpx.HTTPError, ValueError):
            return self._fallback_dem(west, south, east, north)

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
