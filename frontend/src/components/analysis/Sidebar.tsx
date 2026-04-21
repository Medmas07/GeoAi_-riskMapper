"use client";

import { useMemo } from "react";
import {
  useAnalysisStore,
  type AOI,
  type ImagePoint,
  type ProfilePoint,
  type TrajectoryPoint,
} from "@/store/analysis";

function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function generateAnalysisData(aoi: AOI | null): {
  trajectory: TrajectoryPoint[];
  images: ImagePoint[];
  profile: ProfilePoint[];
} {
  const bounds = aoi ?? {
    west: 3.01,
    south: 36.67,
    east: 3.16,
    north: 36.79,
  };

  const count = 72;
  const trajectory: TrajectoryPoint[] = [];
  const images: ImagePoint[] = [];
  const profile: ProfilePoint[] = [];

  const latSpan = bounds.north - bounds.south;
  const lonSpan = bounds.east - bounds.west;
  let cumDist = 0;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const wave = Math.sin(t * Math.PI * 4) * 0.07;
    const lat = bounds.south + latSpan * t + latSpan * wave * 0.15;
    const lon = bounds.west + lonSpan * t + lonSpan * Math.cos(t * Math.PI * 3) * 0.08;
    const elevation = 120 + 45 * Math.sin(t * Math.PI * 2.6) + 25 * Math.cos(t * Math.PI * 5.2);
    const id = `img-${i}`;

    trajectory.push({ lat, lon, elevation, image_id: id });
    images.push({
      id,
      lat,
      lon,
      url: `https://picsum.photos/seed/geoai-${i}/1200/700`,
    });

    if (i > 0) {
      const prev = trajectory[i - 1];
      cumDist += metersBetween(prev.lat, prev.lon, lat, lon);
      const dz = elevation - prev.elevation;
      const slope = (dz / Math.max(1, metersBetween(prev.lat, prev.lon, lat, lon))) * 100;
      profile.push({
        distance: cumDist,
        elevation,
        slope,
      });
    } else {
      profile.push({
        distance: 0,
        elevation,
        slope: 0,
      });
    }
  }

  return { trajectory, images, profile };
}

export default function Sidebar() {
  const mode = useAnalysisStore((s) => s.mode);
  const aoi = useAnalysisStore((s) => s.aoi);
  const currentIndex = useAnalysisStore((s) => s.currentIndex);
  const trajectory = useAnalysisStore((s) => s.trajectory);
  const isRunning = useAnalysisStore((s) => s.isRunning);
  const isPlaying = useAnalysisStore((s) => s.isPlaying);
  const setMode = useAnalysisStore((s) => s.setMode);
  const setData = useAnalysisStore((s) => s.setData);
  const setRunning = useAnalysisStore((s) => s.setRunning);
  const play = useAnalysisStore((s) => s.play);
  const pause = useAnalysisStore((s) => s.pause);

  const hasData = trajectory.length > 0;

  const aoiLabel = useMemo(() => {
    if (!aoi) return "No AOI selected";
    return `${aoi.south.toFixed(4)}, ${aoi.west.toFixed(4)} -> ${aoi.north.toFixed(4)}, ${aoi.east.toFixed(4)}`;
  }, [aoi]);

  async function onRunAnalysis() {
    if (isRunning) return;
    setRunning(true);
    await new Promise((r) => setTimeout(r, 450));
    const data = generateAnalysisData(aoi);
    setData(data);
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
        <h1 className="text-lg font-semibold leading-tight">GeoAI Analyzer</h1>
        <p className={`text-xs mt-1 ${mode === "simple" ? "text-slate-600" : "text-slate-400"}`}>
          Mode: <span className="font-semibold uppercase">{mode}</span>
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
        disabled={isRunning}
        className={`rounded-md px-3 py-2 text-sm font-semibold ${
          isRunning
            ? "bg-slate-500 text-white cursor-not-allowed"
            : "bg-cyan-500 text-black hover:bg-cyan-400"
        }`}
      >
        {isRunning ? "Running..." : "Run Analysis"}
      </button>

      {hasData && (
        <div className={`rounded-md p-3 ${mode === "simple" ? "bg-slate-100" : "bg-slate-900"} space-y-2`}>
          <div className="text-xs">
            Index: <span className="font-semibold">{currentIndex + 1}</span> / {trajectory.length}
          </div>
          <button
            type="button"
            onClick={isPlaying ? pause : play}
            className="w-full rounded bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600"
          >
            {isPlaying ? "Pause Playback" : "Start Playback"}
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === "simple" ? "advanced" : "simple")}
            className="w-full rounded bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600"
          >
            {mode === "simple" ? "Open Advanced View" : "Back To Simple View"}
          </button>
        </div>
      )}

      {!hasData && (
        <div className={`mt-auto text-xs ${mode === "simple" ? "text-slate-600" : "text-slate-400"}`}>
          Draw AOI with Shift + drag on the map, then run analysis.
        </div>
      )}
    </aside>
  );
}
