import numpy as np
from app.schemas.analysis import RiskLayer


def grid_to_geojson_polygons(
    score: np.ndarray,
    category: np.ndarray,
    components: dict,
    bbox: list[float],
    resolution_m: float,
    risk_type: str,
    min_category: int = 1,
) -> list[RiskLayer]:
    """
    Converts a numpy risk grid to a list of GeoJSON polygon features.
    Each cell becomes a polygon. Category 0 cells are skipped by default.
    For production: use rasterio/shapely contour polygons instead.
    """
    from scipy.ndimage import zoom as ndimage_zoom

    # Downsample grid to reduce polygon count
    if score.shape[0] > 50 or score.shape[1] > 50:
        factor = min(1.0, 40.0 / max(score.shape))
        new_h = max(10, int(score.shape[0] * factor))
        new_w = max(10, int(score.shape[1] * factor))
        score = ndimage_zoom(score, (new_h / score.shape[0], new_w / score.shape[1]), order=1)
        category = ndimage_zoom(
            category.astype(float),
            (new_h / category.shape[0], new_w / category.shape[1]),
            order=0,
        ).astype(int)

    west, south, east, north = bbox
    rows, cols = score.shape

    lat_step = (north - south) / rows
    lon_step = (east - west) / cols

    layers = []
    for r in range(rows):
        for c in range(cols):
            s = float(score[r, c])
            cell_category = int(category[r, c])
            if cell_category == 0:
                continue
            if cell_category < min_category:
                continue

            lat0 = north - r * lat_step
            lat1 = lat0 - lat_step
            lon0 = west + c * lon_step
            lon1 = lon0 + lon_step

            polygon = {
                "type": "Polygon",
                "coordinates": [[
                    [lon0, lat0], [lon1, lat0],
                    [lon1, lat1], [lon0, lat1],
                    [lon0, lat0],
                ]],
            }

            layers.append(RiskLayer(
                risk_type=risk_type,
                score=round(s, 3),
                geometry=polygon,
                components={**components, "category": cell_category},
            ))

    if len(layers) > 500:
        layers.sort(key=lambda layer: layer.score, reverse=True)
        layers = layers[:500]

    return layers
