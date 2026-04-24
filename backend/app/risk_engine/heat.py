import numpy as np
from dataclasses import dataclass
from app.processing.terrain.analyzer import TerrainFeatures
from app.processing.weather.analyzer import WeatherFeatures
from app.processing.vision.analyzer import VisionSummary


@dataclass
class HeatRiskGrid:
    score: np.ndarray
    category: np.ndarray
    components: dict


class HeatRiskEngine:
    """
    Urban Heat Island + vulnerability scoring.
    Equity indicators: areas with dense impervious surface + low vegetation
    + high temp are flagged as high heat vulnerability zones.
    """

    # Temperature band: 15°C = comfortable (0), 40°C = extreme (1)
    _TEMP_LOW = 15.0
    _TEMP_HIGH = 40.0

    def compute(
        self,
        terrain: TerrainFeatures,
        weather: WeatherFeatures,
        vision: VisionSummary,
    ) -> HeatRiskGrid:
        shape = terrain.elevation.shape

        # --- Absolute temperature baseline (dominant factor) ---
        # Maps 15°C → 0, 40°C → 1. Works at any real-world temperature.
        temp_contrib = float(np.clip(
            (weather.mean_temp_c - self._TEMP_LOW) / (self._TEMP_HIGH - self._TEMP_LOW), 0, 1
        ))
        temp_score = np.full(shape, temp_contrib)

        # --- Heat stress modifier (humidity + extreme hot hours) ---
        heat_stress_boost = np.full(shape, weather.heat_stress_score * 0.25)

        # --- Urban Heat Island from vision segmentation ---
        uhi_proxy = np.full(shape, vision.mean_impervious * 0.25)

        # --- Vegetation and shadow cooling ---
        veg_cooling = np.full(shape, vision.mean_vegetation * 0.15)
        shadow_cooling = np.full(shape, vision.mean_shadow * 0.10)

        # --- Elevation cooling (lapse rate proxy) ---
        elev_norm = terrain.elevation / (terrain.elevation.max() + 1e-9)
        elevation_cooling = np.clip(elev_norm * 0.05, 0, 0.05)

        # Combine
        heat_score = np.clip(
            temp_score + heat_stress_boost + uhi_proxy - veg_cooling - shadow_cooling - elevation_cooling,
            0, 1
        )

        category = np.digitize(heat_score, bins=[0.2, 0.4, 0.6, 0.8]).astype(int)

        # Heat Island intensity: UHI raises surface temp ~3-10°C over impervious areas
        uhi_intensity_c = round(vision.mean_impervious * 8.0 - vision.mean_vegetation * 3.0, 1)
        # Heat index approx (simplified Steadman, valid for T > 27°C)
        t = weather.mean_temp_c
        humidity_est = min(40 + vision.mean_shadow * 40, 95)  # proxy humidity
        heat_index_c = round(
            t + 0.33 * (humidity_est / 100 * 6.105 * np.exp(17.27 * t / (237.7 + t))) - 4.0, 1
        ) if t > 20 else t
        cooling_deficit = round(max(0.0, float(heat_score.mean()) - vision.mean_vegetation * 0.3), 3)
        high_heat_pct = round(float((heat_score > 0.6).mean()), 3)

        return HeatRiskGrid(
            score=heat_score,
            category=category,
            components={
                "mean_temp_c": round(weather.mean_temp_c, 1),
                "heat_stress_score": weather.heat_stress_score,
                "uhi_proxy": float(vision.mean_impervious),
                "vegetation_coverage": float(vision.mean_vegetation),
                "shadow_coverage": float(vision.mean_shadow),
                "mean_heat_score": round(float(heat_score.mean()), 3),
                # Extra heat stats for display
                "uhi_intensity_c": uhi_intensity_c,
                "heat_index_c": heat_index_c,
                "cooling_deficit": cooling_deficit,
                "high_heat_pct": high_heat_pct,
                "drought_days": weather.drought_days,
                "peak_intensity_mm_hr": round(weather.peak_intensity_mm_hr, 1),
            },
        )
