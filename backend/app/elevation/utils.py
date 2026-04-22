from __future__ import annotations

from math import atan2, ceil, cos, radians, sin, sqrt


Coordinate = list[float]  # [lon, lat]
ElevationPoint = dict[str, float]  # {"lat": ..., "lon": ..., "elevation": ...}


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters."""
    r = 6_371_000.0
    d_lat = radians(lat2 - lat1)
    d_lon = radians(lon2 - lon1)
    a = (
        sin(d_lat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lon / 2) ** 2
    )
    return 2 * r * atan2(sqrt(a), sqrt(1 - a))


def validate_line(line: list[Coordinate]) -> list[Coordinate]:
    if len(line) < 2:
        raise ValueError("line must contain at least 2 coordinates")

    normalized: list[Coordinate] = []
    for coord in line:
        if len(coord) != 2:
            raise ValueError("each coordinate must be [lon, lat]")
        lon, lat = float(coord[0]), float(coord[1])
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValueError(f"invalid coordinate [{lon}, {lat}]")
        normalized.append([lon, lat])

    return normalized


def resample_line(line: list[Coordinate], step_m: float = 10.0) -> list[Coordinate]:
    """
    Resample polyline with approximately `step_m` spacing.
    Keeps original endpoints.
    """
    if step_m <= 0:
        raise ValueError("step_m must be > 0")

    src = validate_line(line)
    out: list[Coordinate] = [src[0]]

    for i in range(1, len(src)):
        lon1, lat1 = src[i - 1]
        lon2, lat2 = src[i]
        seg_m = haversine_m(lat1, lon1, lat2, lon2)

        if seg_m == 0:
            continue

        # Number of interpolation buckets so spacing is <= step_m.
        n = max(1, int(ceil(seg_m / step_m)))
        for j in range(1, n + 1):
            t = j / n
            lon = lon1 + (lon2 - lon1) * t
            lat = lat1 + (lat2 - lat1) * t
            out.append([lon, lat])

    # Ensure exact final endpoint.
    if out[-1] != src[-1]:
        out.append(src[-1])

    return out


def compute_profile(points: list[ElevationPoint]) -> tuple[list[dict[str, float]], float]:
    """
    Build profile from normalized points.
    profile item: {"lat","lon","distance","elevation","slope"}.
    """
    if not points:
        return [], 0.0

    profile: list[dict[str, float]] = []
    cumulative_m = 0.0

    for i, p in enumerate(points):
        lat = float(p["lat"])
        lon = float(p["lon"])
        elevation = float(p["elevation"])

        if i == 0:
            slope = 0.0
        else:
            prev = points[i - 1]
            prev_lat = float(prev["lat"])
            prev_lon = float(prev["lon"])
            prev_elev = float(prev["elevation"])

            seg_m = haversine_m(prev_lat, prev_lon, lat, lon)
            cumulative_m += seg_m
            slope = ((elevation - prev_elev) / seg_m * 100.0) if seg_m > 0 else 0.0

        profile.append(
            {
                "lat": lat,
                "lon": lon,
                "distance": cumulative_m,
                "elevation": elevation,
                "slope": slope,
            }
        )

    return profile, cumulative_m
