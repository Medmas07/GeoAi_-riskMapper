"use client";

import { useMemo } from "react";
import { useAnalysisStore, type ProfilePoint, type TrajectoryPoint } from "@/store/analysis";
import { api } from "@/lib/api";
import type { ElevationProfileResponse, MapillaryImage } from "@/types";

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const r = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sortImagesByNearest(images: MapillaryImage[]): MapillaryImage[] {
  if (images.length <= 1) return images;

  const sorted = [images[0]];
  const remaining = images.slice(1);

  while (remaining.length) {
    const last = sorted[sorted.length - 1];
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const d = Math.hypot(candidate.lat - last.lat, candidate.lon - last.lon);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }

    sorted.push(remaining.splice(nearestIdx, 1)[0]);
  }

  return sorted;
}

function buildFlatTrajectoryAndProfile(images: MapillaryImage[]): {
  trajectory: TrajectoryPoint[];
  profile: ProfilePoint[];
} {
  const trajectory: TrajectoryPoint[] = [];
  const profile: ProfilePoint[] = [];

  let cumulative = 0;
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const elevation = 0;
    trajectory.push({
      lat: image.lat,
      lon: image.lon,
      elevation,
      image_id: image.id,
    });

    if (i > 0) {
      const prev = images[i - 1];
      cumulative += haversineMeters(prev.lat, prev.lon, image.lat, image.lon);
    }

    profile.push({
      distance: cumulative,
      elevation,
      slope: 0,
    });
  }

  return { trajectory, profile };
}

function buildTrajectoryAndProfileFromElevation(
  images: MapillaryImage[],
  elevationResponse: ElevationProfileResponse
): {
  trajectory: TrajectoryPoint[];
  profile: ProfilePoint[];
} {
  const source = elevationResponse.profile;
  if (!source.length) return buildFlatTrajectoryAndProfile(images);

  const sampledElevations: number[] = [];
  const lastSourceIndex = source.length - 1;
  const lastImageIndex = Math.max(1, images.length - 1);

  for (let i = 0; i < images.length; i++) {
    const srcIdx = Math.round((i * lastSourceIndex) / lastImageIndex);
    sampledElevations.push(source[srcIdx].elevation);
  }

  const trajectory: TrajectoryPoint[] = [];
  const profile: ProfilePoint[] = [];
  let cumulative = 0;

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const elevation = sampledElevations[i];

    trajectory.push({
      lat: image.lat,
      lon: image.lon,
      elevation,
      image_id: image.id,
    });

    let slope = 0;
    if (i > 0) {
      const prevImage = images[i - 1];
      const prevElevation = sampledElevations[i - 1];
      const segment = haversineMeters(prevImage.lat, prevImage.lon, image.lat, image.lon);
      cumulative += segment;
      slope = segment > 0 ? ((elevation - prevElevation) / segment) * 100 : 0;
    }

    profile.push({
      distance: cumulative,
      elevation,
      slope,
    });
  }

  return { trajectory, profile };
}

export default function Sidebar() {
  const mode = useAnalysisStore((s) => s.mode);
  const setMode = useAnalysisStore((s) => s.setMode);
  const aoi = useAnalysisStore((s) => s.aoi);
  const isRunning = useAnalysisStore((s) => s.isRunning);
  const activeLayer = useAnalysisStore((s) => s.activeLayer);
  const floodLayers = useAnalysisStore((s) => s.floodLayers);
  const setRunning = useAnalysisStore((s) => s.setRunning);
  const setRiskResults = useAnalysisStore((s) => s.setRiskResults);
  const setActiveLayer = useAnalysisStore((s) => s.setActiveLayer);
  const setAOI = useAnalysisStore((s) => s.setAOI);
  const setData = useAnalysisStore((s) => s.setData);

  const hasResults = floodLayers.length > 0;

  const aoiLabel = useMemo(() => {
    if (!aoi) return "No AOI selected";
    return `${aoi.south.toFixed(4)}, ${aoi.west.toFixed(4)} -> ${aoi.north.toFixed(4)}, ${aoi.east.toFixed(4)}`;
  }, [aoi]);

  async function onRunAnalysis() {
    if (isRunning || !aoi) return;
    setRunning(true);

    try {
      const { run_id } = await api.analysis.run({
        bbox: aoi,
        weather_days_back: 7,
      });
      const result = await api.analysis.poll(run_id);

      if (result.status !== "completed") {
        alert(`Analysis failed: ${result.status}`);
        return;
      }

      setRiskResults(result.flood_layers, result.heat_layers);

      const rawImages = await api.mapillary.images(aoi.west, aoi.south, aoi.east, aoi.north);
      const sortedImages = sortImagesByNearest(rawImages);

      let trajectory: TrajectoryPoint[] = [];
      let profile: ProfilePoint[] = [];

      if (sortedImages.length >= 2) {
        try {
          const elevation = await api.elevation.profile({
            line: sortedImages.map((img) => [img.lon, img.lat] as [number, number]),
            use_fallback: true,
          });
          console.info(
            `[elevation] provider=${elevation.provider} dataset=${elevation.dataset ?? "default"} points=${elevation.points.length}`
          );
          const built = buildTrajectoryAndProfileFromElevation(sortedImages, elevation);
          trajectory = built.trajectory;
          profile = built.profile;
        } catch (error) {
          console.warn("[elevation] profile API failed, using flat fallback profile", error);
          const built = buildFlatTrajectoryAndProfile(sortedImages);
          trajectory = built.trajectory;
          profile = built.profile;
        }
      } else {
        const built = buildFlatTrajectoryAndProfile(sortedImages);
        trajectory = built.trajectory;
        profile = built.profile;
      }

      setData({
        trajectory,
        profile,
        images: sortedImages.map((img) => ({
          id: img.id,
          lat: img.lat,
          lon: img.lon,
          url: img.thumb_url ?? `https://picsum.photos/seed/${img.id}/1200/700`,
        })),
      });

      setMode("advanced");

      // Nudge map fit refresh after state update.
      const currentAoi = aoi;
      setAOI(null);
      setTimeout(() => setAOI(currentAoi), 50);
    } catch (error) {
      alert(`Error: ${String(error)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <aside
      className={`h-full ${
        mode === "simple"
          ? "rounded-xl border border-slate-200/70 bg-white/90 backdrop-blur shadow-lg text-slate-900"
          : "bg-[#0d1526] text-slate-100"
      } p-4 flex flex-col gap-4`}
    >
      <div>
        <h1 className="text-lg font-semibold leading-tight">GeoAI Risk Mapper</h1>
        <p className={`text-xs mt-1 ${mode === "simple" ? "text-slate-600" : "text-slate-400"}`}>
          Flood & Heat Risk Analysis
        </p>
      </div>

      <div
        className={`text-xs rounded-md p-2 ${
          mode === "simple" ? "bg-slate-100 text-slate-700" : "bg-slate-900 text-slate-300"
        }`}
      >
        AOI: {aoiLabel}
      </div>

      <button
        type="button"
        onClick={onRunAnalysis}
        disabled={isRunning || !aoi}
        className={`rounded-md px-3 py-2 text-sm font-semibold ${
          isRunning || !aoi
            ? "bg-slate-500 text-white cursor-not-allowed"
            : "bg-cyan-500 text-black hover:bg-cyan-400"
        }`}
      >
        {isRunning ? "Analyzing..." : !aoi ? "Draw AOI first" : "Run Analysis"}
      </button>

      {hasResults && (
        <div className={`rounded-md p-3 ${mode === "simple" ? "bg-slate-100" : "bg-slate-900"} space-y-2`}>
          <p className="text-xs font-semibold">Risk Layer</p>
          <div className="flex gap-2">
            {(["flood", "heat"] as const).map((layer) => (
              <button
                key={layer}
                type="button"
                onClick={() => setActiveLayer(layer)}
                className={`flex-1 rounded px-2 py-1 text-xs font-semibold capitalize ${
                  activeLayer === layer
                    ? layer === "flood"
                      ? "bg-blue-500 text-white"
                      : "bg-orange-500 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                {layer}
              </button>
            ))}
          </div>
          <div className="text-xs space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: "#4caf50" }} />
              Low
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: "#ffeb3b" }} />
              Medium
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: "#ff9800" }} />
              High
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: "#f44336" }} />
              Extreme
            </div>
          </div>
        </div>
      )}

      {!hasResults && !isRunning && (
        <div className={`mt-auto text-xs ${mode === "simple" ? "text-slate-600" : "text-slate-400"}`}>
          Hold Shift + drag on map to draw AOI, then run analysis.
        </div>
      )}
    </aside>
  );
}
