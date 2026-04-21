"use client";

import { useAnalysisStore } from "@/store/analysis";

export function useAnalysis() {
  const setRunning = useAnalysisStore((s) => s.setRunning);
  const setData = useAnalysisStore((s) => s.setData);
  const aoi = useAnalysisStore((s) => s.aoi);

  async function runAnalysis() {
    setRunning(true);
    await new Promise((r) => setTimeout(r, 450));

    const base = aoi ?? {
      west: 3.01,
      south: 36.67,
      east: 3.16,
      north: 36.79,
    };

    const trajectory = [
      { lat: base.south, lon: base.west, elevation: 112, image_id: "img-0" },
      { lat: base.north, lon: base.east, elevation: 138, image_id: "img-1" },
    ];
    const images = trajectory.map((p, i) => ({
      id: `img-${i}`,
      url: `https://picsum.photos/seed/fallback-${i}/1200/700`,
      lat: p.lat,
      lon: p.lon,
    }));
    const profile = [
      { distance: 0, elevation: trajectory[0].elevation, slope: 0 },
      { distance: 2200, elevation: trajectory[1].elevation, slope: 1.18 },
    ];

    setData({ trajectory, images, profile });
  }

  return { runAnalysis };
}
