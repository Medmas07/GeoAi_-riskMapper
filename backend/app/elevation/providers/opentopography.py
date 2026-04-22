from __future__ import annotations

from time import monotonic
import httpx

from app.core.config import settings
from app.elevation.providers.base import PointElevationProvider
from app.elevation.utils import Coordinate


class OpenTopographyProvider(PointElevationProvider):
    """
    Uses OpenTopography Global DEM API and samples elevations at requested points.
    """

    name = "opentopography"
    endpoint = "https://portal.opentopography.org/API/globaldem"

    def __init__(self, demtype: str = "SRTMGL1"):
        self.demtype = demtype

    async def _fetch_points(self, sampled_line: list[Coordinate]) -> list[float]:
        if not settings.OPENTOPOGRAPHY_API_KEY:
            raise RuntimeError("OPENTOPOGRAPHY_API_KEY is not configured")

        lons = [p[0] for p in sampled_line]
        lats = [p[1] for p in sampled_line]

        # Small padding so boundary points always map inside fetched grid.
        pad = 0.0001
        west = min(lons) - pad
        east = max(lons) + pad
        south = min(lats) - pad
        north = max(lats) + pad

        deadline = monotonic() + self.timeout_budget_s
        params = {
            "demtype": self.demtype,
            "west": west,
            "south": south,
            "east": east,
            "north": north,
            "outputFormat": "AAIGrid",
            "API_Key": settings.OPENTOPOGRAPHY_API_KEY,
        }

        async with httpx.AsyncClient() as client:
            text = await self._request_text(
                client,
                "GET",
                self.endpoint,
                deadline=deadline,
                params=params,
            )

        grid = _parse_ascii_grid(text)
        elevations = [_sample_nearest(grid, lon=lon, lat=lat) for lon, lat in sampled_line]
        return elevations


def _parse_ascii_grid(text: str) -> dict:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    header: dict[str, float] = {}

    i = 0
    while i < len(lines):
        parts = lines[i].split()
        key = parts[0].lower()
        if key in {"ncols", "nrows", "xllcorner", "yllcorner", "cellsize", "nodata_value"}:
            header[key] = float(parts[1])
            i += 1
            continue
        break

    required = {"ncols", "nrows", "xllcorner", "yllcorner", "cellsize"}
    if not required.issubset(header):
        raise RuntimeError("OpenTopography returned invalid AAIGrid header")

    ncols = int(header["ncols"])
    nrows = int(header["nrows"])
    rows: list[list[float]] = []
    for j in range(i, len(lines)):
        row = [float(v) for v in lines[j].split()]
        if row:
            rows.append(row)

    if len(rows) != nrows:
        raise RuntimeError("OpenTopography AAIGrid row count mismatch")
    for row in rows:
        if len(row) != ncols:
            raise RuntimeError("OpenTopography AAIGrid column count mismatch")

    header["rows"] = rows  # type: ignore[assignment]
    return header


def _sample_nearest(grid: dict, lon: float, lat: float) -> float:
    rows: list[list[float]] = grid["rows"]  # type: ignore[assignment]
    ncols = int(grid["ncols"])
    nrows = int(grid["nrows"])
    xll = float(grid["xllcorner"])
    yll = float(grid["yllcorner"])
    cell = float(grid["cellsize"])
    nodata = grid.get("nodata_value")

    # AAIGrid rows are ordered north -> south.
    north = yll + nrows * cell
    col = int(round((lon - xll) / cell))
    row = int(round((north - lat) / cell))

    col = max(0, min(ncols - 1, col))
    row = max(0, min(nrows - 1, row))

    value = float(rows[row][col])
    if nodata is not None and value == float(nodata):
        raise RuntimeError("OpenTopography returned nodata value")
    return value

