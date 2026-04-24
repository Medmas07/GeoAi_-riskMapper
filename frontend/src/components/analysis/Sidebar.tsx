"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAnalysisStore,
  type DrawnPathPoint,
  type ProfilePoint,
  type TrajectoryPoint,
} from "@/store/analysis";
import { api } from "@/lib/api";
import type {
  ElevationProfileOptionsResponse,
  ElevationProfileResponse,
  ElevationProviderName,
  MapillaryImage,
} from "@/types";

// ── Pure helpers (unchanged) ─────────────────────────────────────────────────

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
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
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
    trajectory.push({ lat: image.lat, lon: image.lon, elevation: 0, image_id: image.id });
    if (i > 0) {
      const prev = images[i - 1];
      cumulative += haversineMeters(prev.lat, prev.lon, image.lat, image.lon);
    }
    profile.push({ distance: cumulative, elevation: 0, slope: 0 });
  }
  return { trajectory, profile };
}

function buildTrajectoryAndProfileFromElevation(
  images: MapillaryImage[],
  elevationResponse: ElevationProfileResponse
): { trajectory: TrajectoryPoint[]; profile: ProfilePoint[] } {
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
    trajectory.push({ lat: image.lat, lon: image.lon, elevation, image_id: image.id });
    let slope = 0;
    if (i > 0) {
      const prevImage = images[i - 1];
      const prevElevation = sampledElevations[i - 1];
      const segment = haversineMeters(prevImage.lat, prevImage.lon, image.lat, image.lon);
      cumulative += segment;
      slope = segment > 0 ? ((elevation - prevElevation) / segment) * 100 : 0;
    }
    profile.push({ distance: cumulative, elevation, slope });
  }
  return { trajectory, profile };
}

type ProviderSelectValue = "default" | ElevationProviderName;
type DatasetOption = { value: string; label: string };

const FALLBACK_PROVIDER_OPTIONS: ElevationProviderName[] = [
  "ors", "opentopography", "opentopodata", "openelevation", "geonames",
];
const PROVIDER_LABELS: Record<ElevationProviderName, string> = {
  ors: "OpenRouteService",
  opentopography: "OpenTopography",
  opentopodata: "OpenTopoData",
  openelevation: "Open-Elevation",
  geonames: "GeoNames",
};

function toDatasetOptions(
  provider: ProviderSelectValue,
  options: ElevationProfileOptionsResponse | null
): DatasetOption[] {
  if (!options || provider === "default") return [];
  if (provider === "opentopodata") {
    const datasets = options.datasets?.opentopodata ?? {};
    return Object.entries(datasets).map(([key, value]) => ({
      value: value?.slug ?? key,
      label: value?.label ?? key,
    }));
  }
  if (provider === "opentopography") {
    const datasets = options.datasets?.opentopography ?? {};
    return Object.entries(datasets).map(([key, value]) => ({ value: key, label: `${key} - ${value}` }));
  }
  if (provider === "geonames") {
    const datasets = options.datasets?.geonames ?? {};
    return Object.entries(datasets).map(([key, value]) => ({
      value: key,
      label: value?.resolution ? `${key} (${value.resolution})` : key,
    }));
  }
  return [];
}

function isSameAoi(
  a: { west: number; south: number; east: number; north: number } | null,
  b: { west: number; south: number; east: number; north: number } | null
): boolean {
  if (!a || !b) return false;
  return a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
      {children}
    </p>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 ${className}`}>
      {children}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function Sidebar() {
  const aoi = useAnalysisStore((s) => s.aoi);
  const drawnPath = useAnalysisStore((s) => s.drawnPath);
  const isRunning = useAnalysisStore((s) => s.isRunning);
  const activeLayer = useAnalysisStore((s) => s.activeLayer);
  const floodLayers = useAnalysisStore((s) => s.floodLayers);
  const lastAnalyzedBbox = useAnalysisStore((s) => s.lastAnalyzedBbox);
  const lastAnalysisDurationSeconds = useAnalysisStore((s) => s.lastAnalysisDurationSeconds);
  const setRunning = useAnalysisStore((s) => s.setRunning);
  const setRiskResults = useAnalysisStore((s) => s.setRiskResults);
  const setActiveLayer = useAnalysisStore((s) => s.setActiveLayer);
  const setLastAnalysisDurationSeconds = useAnalysisStore((s) => s.setLastAnalysisDurationSeconds);
  const setAOI = useAnalysisStore((s) => s.setAOI);
  const flyTo = useAnalysisStore((s) => s.flyTo);
  const pathWidthMeters = useAnalysisStore((s) => s.pathWidthMeters);
  const setData = useAnalysisStore((s) => s.setData);
  const mode = useAnalysisStore((s) => s.mode);
  const setMode = useAnalysisStore((s) => s.setMode);

  const [profileOptions, setProfileOptions] = useState<ElevationProfileOptionsResponse | null>(null);
  const [elevationProvider, setElevationProvider] = useState<ProviderSelectValue>("default");
  const [elevationDataset, setElevationDataset] = useState<string>("default");
  const lastAppliedWidthRef = useRef<number | null>(null);

  const hasResults = floodLayers.length > 0;

  useEffect(() => {
    let active = true;
    api.elevation.options().then((options) => {
      if (!active) return;
      setProfileOptions(options);
    }).catch((error) => {
      console.warn("[elevation] options API unavailable, using defaults", error);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => { setElevationDataset("default"); }, [elevationProvider]);

  const aoiLabel = useMemo(() => {
    if (!aoi) return null;
    return {
      span: `${((aoi.north - aoi.south) * 111).toFixed(1)} × ${((aoi.east - aoi.west) * 111).toFixed(1)} km`,
      coords: `${aoi.south.toFixed(4)}°N  ${aoi.west.toFixed(4)}°E`,
    };
  }, [aoi]);

  const providerOptions = useMemo(() => {
    const configured = (profileOptions?.providers ?? FALLBACK_PROVIDER_OPTIONS).filter(
      (p): p is ElevationProviderName => FALLBACK_PROVIDER_OPTIONS.includes(p as ElevationProviderName)
    );
    return configured.length ? configured : FALLBACK_PROVIDER_OPTIONS;
  }, [profileOptions]);

  const datasetOptions = useMemo(
    () => toDatasetOptions(elevationProvider, profileOptions),
    [elevationProvider, profileOptions]
  );

  async function fetchMapillaryImages(
    path: DrawnPathPoint[] | null,
    widthMeters: number,
    aoiBox: typeof aoi
  ): Promise<MapillaryImage[]> {
    if (path && path.length >= 2) {
      const alongPath = await api.mapillary.imagesAlongPath(path, widthMeters).catch(() => []);
      if (alongPath.length > 0) return alongPath;
    }
    if (!aoiBox) return [];
    const bboxImages = await api.mapillary
      .images(aoiBox.west, aoiBox.south, aoiBox.east, aoiBox.north)
      .catch(() => []);
    return sortImagesByNearest(bboxImages);
  }

  async function buildTrajectoryAndProfile(
    sortedImages: MapillaryImage[]
  ): Promise<{ trajectory: TrajectoryPoint[]; profile: ProfilePoint[] }> {
    if (sortedImages.length < 2) return buildFlatTrajectoryAndProfile(sortedImages);
    try {
      const selectedProvider = elevationProvider === "default" ? undefined : elevationProvider;
      const selectedDataset = elevationDataset === "default" ? undefined : elevationDataset;
      const elevation = await api.elevation.profile({
        line: sortedImages.map((img) => [img.lon, img.lat] as [number, number]),
        provider: selectedProvider,
        dataset: selectedDataset,
        use_fallback: true,
      });
      return buildTrajectoryAndProfileFromElevation(sortedImages, elevation);
    } catch (error) {
      console.warn("[elevation] profile API failed, using flat fallback", error);
      return buildFlatTrajectoryAndProfile(sortedImages);
    }
  }

  useEffect(() => {
    if (mode !== "advanced" || !hasResults || !drawnPath || drawnPath.length < 2) return;
    if (lastAppliedWidthRef.current === pathWidthMeters) return;

    const timeoutId = setTimeout(async () => {
      try {
        const sortedImgs = await fetchMapillaryImages(drawnPath, pathWidthMeters, aoi);
        const { trajectory, profile } = await buildTrajectoryAndProfile(sortedImgs);
        setData({
          trajectory,
          profile,
          images: sortedImgs.map((img) => ({
            id: img.id,
            lat: img.lat,
            lon: img.lon,
            thumb_url: img.thumb_url,
            url: img.thumb_url ?? "https://placehold.co/1200x700/0f172a/ffffff?text=No+Mapillary+Image+Found",
          })),
        });
        lastAppliedWidthRef.current = pathWidthMeters;
      } catch (error) {
        console.error("Failed to refetch mapillary images on width change:", error);
      }
    }, 400);

    return () => clearTimeout(timeoutId);
  }, [pathWidthMeters, mode, hasResults, drawnPath, aoi, setData, elevationProvider, elevationDataset]);

  async function onRunAnalysis() {
    if (isRunning || !aoi) return;
    if (floodLayers.length > 0 && isSameAoi(aoi, lastAnalyzedBbox)) return;

    setRunning(true);
    setLastAnalysisDurationSeconds(null);
    const startedAt = Date.now();

    try {
      const { run_id } = await api.analysis.run({ bbox: aoi, weather_days_back: 7 });
      const result = await api.analysis.poll(run_id);
      const completedAt = Date.now();
      setLastAnalysisDurationSeconds((completedAt - startedAt) / 1000);

      if (result.status !== "completed") {
        alert(`Analysis failed: ${result.status}`);
        return;
      }

      const backendImages = (result.images ?? []).slice(0, 200);
      const normalizedImages = backendImages.map((img) => ({
        id: img.id,
        lat: img.lat,
        lon: img.lon,
        url: img.url ?? img.thumb_url ?? "https://placehold.co/1200x700/0f172a/ffffff?text=No+Mapillary+Image+Found",
      }));

      const trajectoryFromResult =
        result.trajectory?.map((point, index) => ({
          lat: point.lat,
          lon: point.lon,
          elevation: point.elevation ?? 0,
          image_id: point.image_id ?? normalizedImages[index]?.id ?? `pt-${index}`,
        })) ??
        normalizedImages.map((img) => ({ lat: img.lat, lon: img.lon, elevation: 0, image_id: img.id }));

      const { profile } = await buildTrajectoryAndProfile(normalizedImages);

      setData({ trajectory: trajectoryFromResult, profile, images: normalizedImages });
      setRiskResults(result.flood_layers ?? [], result.heat_layers ?? []);
      setMode("advanced");
      setAOI(aoi);
      flyTo({
        lat: (aoi.north + aoi.south) / 2,
        lon: (aoi.east + aoi.west) / 2,
        zoom: 13,
      });
    } catch (error) {
      alert(`Error: ${String(error)}`);
    } finally {
      setRunning(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <aside className="flex h-full flex-col gap-3 overflow-y-auto bg-[#0d1526] p-4 text-slate-100">
      {/* Header */}
      <div className="flex items-center gap-3 pb-1">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300 shadow-[0_0_24px_rgba(34,211,238,0.15)]">
          <svg viewBox="0 0 18 18" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="9" cy="9" r="6.5" />
            <path d="M9 4v5l3 2" strokeLinecap="round" />
            <circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div>
          <h1 className="text-sm font-bold leading-none tracking-tight text-slate-50">
            GeoAI Risk Mapper
          </h1>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-cyan-400/70">
            Flood · Heat · Terrain
          </p>
        </div>
      </div>

      <div className="h-px w-full bg-white/[0.06]" />

      {/* AOI */}
      <Panel>
        <SectionLabel>Area of Interest</SectionLabel>
        {aoiLabel ? (
          <div className="space-y-1">
            <div className="text-sm font-semibold text-slate-100">{aoiLabel.span}</div>
            <div className="font-mono text-[11px] text-slate-400">{aoiLabel.coords}</div>
            {drawnPath && drawnPath.length >= 2 && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                {drawnPath.length} path points
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 1C4.8 1 3 2.8 3 5c0 3.5 4 8 4 8s4-4.5 4-8c0-2.2-1.8-4-4-4z" />
              <circle cx="7" cy="5" r="1.3" />
            </svg>
            No path drawn yet
          </div>
        )}
      </Panel>

      {mode === "advanced" && (
        <>
          {/* Elevation source */}
          <Panel>
            <SectionLabel>Elevation Data</SectionLabel>
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-slate-600">
                  Provider
                </label>
                <select
                  value={elevationProvider}
                  onChange={(e) => setElevationProvider(e.target.value as ProviderSelectValue)}
                  className="select-dark w-full rounded-lg border border-white/[0.08] bg-[#0b1220] px-2.5 py-1.5 text-xs text-slate-200 focus:border-cyan-400/30 focus:outline-none"
                >
                  <option value="default">Auto (default chain)</option>
                  {providerOptions.map((p) => (
                    <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-slate-600">
                  Dataset
                </label>
                <select
                  value={elevationDataset}
                  onChange={(e) => setElevationDataset(e.target.value)}
                  disabled={elevationProvider === "default" || datasetOptions.length === 0}
                  className="select-dark w-full rounded-lg border border-white/[0.08] bg-[#0b1220] px-2.5 py-1.5 text-xs text-slate-200 focus:border-cyan-400/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <option value="default">
                    {elevationProvider === "default"
                      ? "Default chain selection"
                      : datasetOptions.length
                      ? "Default dataset"
                      : "No dataset option"}
                  </option>
                  {datasetOptions.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </Panel>
        </>
      )}

      {/* Run Analysis CTA */}
      <button
        type="button"
        onClick={onRunAnalysis}
        disabled={isRunning || !aoi}
        className={`relative w-full overflow-hidden rounded-xl px-4 py-3 text-sm font-bold transition-all duration-300 ${
          isRunning
            ? "cursor-not-allowed bg-slate-800 text-slate-500"
            : !aoi
            ? "cursor-not-allowed bg-slate-800/60 text-slate-600"
            : "animate-glow-pulse bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500 active:scale-[0.98]"
        }`}
      >
        {isRunning ? (
          <span className="flex items-center justify-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-slate-300" />
            Analyzing…
          </span>
        ) : !aoi ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="h-4 w-4 opacity-50" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 2C5.2 2 3 4.2 3 7c0 4.5 5 9 5 9s5-4.5 5-9c0-2.8-2.2-5-5-5z" />
              <circle cx="8" cy="7" r="1.5" />
            </svg>
            Draw a path first
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <polygon points="3,2 13,8 3,14" fill="currentColor" stroke="none" />
            </svg>
            Run Analysis
          </span>
        )}
      </button>

      {/* Duration badge */}
      {mode === "advanced" && lastAnalysisDurationSeconds !== null && hasResults && (
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[11px] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {lastAnalysisDurationSeconds < 0.5
            ? `Cached — ${lastAnalysisDurationSeconds.toFixed(1)}s`
            : `Completed in ${lastAnalysisDurationSeconds.toFixed(1)}s`}
        </div>
      )}

      {/* Risk layer controls */}
      {mode === "advanced" && hasResults && (
        <Panel>
          <SectionLabel>Risk Layer</SectionLabel>

          {/* Segmented control */}
          <div className="flex rounded-lg border border-white/[0.08] bg-black/20 p-0.5">
            {(["flood", "heat"] as const).map((layer) => (
              <button
                key={layer}
                type="button"
                onClick={() => setActiveLayer(layer)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold capitalize transition-all ${
                  activeLayer === layer
                    ? layer === "flood"
                      ? "bg-blue-500/20 text-blue-300 shadow-inner"
                      : "bg-orange-500/20 text-orange-300 shadow-inner"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {layer === "flood" ? (
                  <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="M1 9c1-2 2-3 3-3s2 2 3 2 2-2 3-2" strokeLinecap="round" />
                    <path d="M1 6c1-2 2-3 3-3s2 2 3 2 2-2 3-2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <circle cx="6" cy="6" r="3" />
                    <path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.5 2.5l.7.7M8.8 8.8l.7.7M2.5 9.5l.7-.7M8.8 3.2l.7-.7" strokeLinecap="round" />
                  </svg>
                )}
                {layer}
              </button>
            ))}
          </div>

          {/* Legend gradient bar */}
          <div className="mt-3">
            <div
              className="h-2 w-full rounded-full"
              style={{ background: "linear-gradient(to right, #4caf50, #ffeb3b, #ff9800, #f44336)" }}
            />
            <div className="mt-1.5 flex justify-between text-[10px] font-medium text-slate-500">
              <span>Low</span>
              <span>Medium</span>
              <span>High</span>
              <span>Extreme</span>
            </div>
          </div>
        </Panel>
      )}

      {/* Instructions */}
      {mode === "advanced" && !hasResults && !isRunning && (
        <div className="mt-auto rounded-xl border border-white/[0.05] bg-white/[0.02] p-3 text-xs leading-relaxed text-slate-500">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            Getting started
          </p>
          Use <span className="text-slate-400">Draw Path</span> on the map to trace a road or area,
          then press <span className="text-slate-400">Run Analysis</span> to compute flood and heat risk.
        </div>
      )}
    </aside>
  );
}
