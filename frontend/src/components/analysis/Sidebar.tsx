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

type ProviderSelectValue = "default" | ElevationProviderName;

type DatasetOption = {
  value: string;
  label: string;
};

const FALLBACK_PROVIDER_OPTIONS: ElevationProviderName[] = [
  "ors",
  "opentopography",
  "opentopodata",
  "openelevation",
  "geonames",
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
    return Object.entries(datasets).map(([key, value]) => ({
      value: key,
      label: `${key} - ${value}`,
    }));
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

export default function Sidebar() {
  const mode = useAnalysisStore((s) => s.mode);
  const setMode = useAnalysisStore((s) => s.setMode);
  const aoi = useAnalysisStore((s) => s.aoi);
  const drawnPath = useAnalysisStore((s) => s.drawnPath);
  const isRunning = useAnalysisStore((s) => s.isRunning);
  const activeLayer = useAnalysisStore((s) => s.activeLayer);
  const floodLayers = useAnalysisStore((s) => s.floodLayers);
  const setRunning = useAnalysisStore((s) => s.setRunning);
  const setRiskResults = useAnalysisStore((s) => s.setRiskResults);
  const setActiveLayer = useAnalysisStore((s) => s.setActiveLayer);
  const setAOI = useAnalysisStore((s) => s.setAOI);
  const pathWidthMeters = useAnalysisStore((s) => s.pathWidthMeters);
  const setPathWidthMeters = useAnalysisStore((s) => s.setPathWidthMeters);
  const setData = useAnalysisStore((s) => s.setData);

  const [profileOptions, setProfileOptions] = useState<ElevationProfileOptionsResponse | null>(null);
  const [elevationProvider, setElevationProvider] = useState<ProviderSelectValue>("default");
  const [elevationDataset, setElevationDataset] = useState<string>("default");
  const lastAppliedWidthRef = useRef<number | null>(null);

  const hasResults = floodLayers.length > 0;

  useEffect(() => {
    let active = true;

    api.elevation
      .options()
      .then((options) => {
        if (!active) return;
        setProfileOptions(options);
      })
      .catch((error) => {
        console.warn("[elevation] options API unavailable, using defaults", error);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setElevationDataset("default");
  }, [elevationProvider]);

  const aoiLabel = useMemo(() => {
    if (!aoi) return "No path drawn";
    const spanLat = ((aoi.north - aoi.south) * 111).toFixed(1);
    const spanLon = ((aoi.east - aoi.west) * 111).toFixed(1);
    return `${spanLat} x ${spanLon} km (${aoi.south.toFixed(4)}, ${aoi.west.toFixed(4)})`;
  }, [aoi]);

  const providerOptions = useMemo(() => {
    const configured = (profileOptions?.providers ?? FALLBACK_PROVIDER_OPTIONS).filter(
      (provider): provider is ElevationProviderName =>
        FALLBACK_PROVIDER_OPTIONS.includes(provider as ElevationProviderName)
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
      if (alongPath.length > 0) {
        return alongPath;
      }
      console.log("No images along exact path, falling back to bounding box query");
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
    if (sortedImages.length < 2) {
      return buildFlatTrajectoryAndProfile(sortedImages);
    }

    try {
      const selectedProvider = elevationProvider === "default" ? undefined : elevationProvider;
      const selectedDataset = elevationDataset === "default" ? undefined : elevationDataset;
      // Keep selected provider as first choice, but allow fallback chain
      // to avoid hard failures when one provider times out.
      const useFallback = true;

      const elevation = await api.elevation.profile({
        line: sortedImages.map((img) => [img.lon, img.lat] as [number, number]),
        provider: selectedProvider,
        dataset: selectedDataset,
        use_fallback: useFallback,
      });
      console.info(
        `[elevation] provider=${elevation.provider} dataset=${elevation.dataset ?? "default"} points=${elevation.points.length}`
      );
      return buildTrajectoryAndProfileFromElevation(sortedImages, elevation);
    } catch (error) {
      console.warn("[elevation] profile API failed, using flat fallback profile", error);
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
            url:
              img.thumb_url ??
              "https://placehold.co/1200x700/0f172a/ffffff?text=No+Mapillary+Image+Found",
          })),
        });
        lastAppliedWidthRef.current = pathWidthMeters;
      } catch (error) {
        console.error("Failed to refetch mapillary images on width change:", error);
      }
    }, 400);

    return () => clearTimeout(timeoutId);
  }, [
    pathWidthMeters,
    mode,
    hasResults,
    drawnPath,
    aoi,
    setData,
    elevationProvider,
    elevationDataset,
  ]);

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

      const sortedImages = await fetchMapillaryImages(drawnPath, pathWidthMeters, aoi);
      const { trajectory, profile } = await buildTrajectoryAndProfile(sortedImages);

      setData({
        trajectory,
        profile,
        images: sortedImages.map((img) => ({
          id: img.id,
          lat: img.lat,
          lon: img.lon,
          url:
            img.thumb_url ??
            "https://placehold.co/1200x700/0f172a/ffffff?text=No+Mapillary+Image+Found",
        })),
      });
      lastAppliedWidthRef.current = pathWidthMeters;

      setMode("advanced");

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
        <span className="font-semibold">AOI: </span>
        {aoiLabel}
        {drawnPath && drawnPath.length >= 2 && (
          <span className={`ml-1 ${mode === "simple" ? "text-cyan-600" : "text-cyan-400"}`}>
            ({drawnPath.length} pts)
          </span>
        )}
      </div>

      <div
        className={`text-xs rounded-md p-2 ${
          mode === "simple" ? "bg-slate-100 text-slate-700" : "bg-slate-900 text-slate-300"
        }`}
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold">Line Width</span>
          <span>{pathWidthMeters} m</span>
        </div>
        <input
          type="range"
          min={5}
          max={120}
          step={5}
          value={pathWidthMeters}
          onChange={(event) => setPathWidthMeters(Number(event.target.value))}
          className="w-full accent-cyan-500"
        />
      </div>

      <div
        className={`rounded-md p-3 space-y-2 ${
          mode === "simple" ? "bg-slate-100 text-slate-700" : "bg-slate-900 text-slate-200"
        }`}
      >
        <p className="text-xs font-semibold">Elevation Source</p>

        <div className="space-y-1">
          <label className="block text-[11px] uppercase tracking-wide opacity-80">Provider</label>
          <select
            value={elevationProvider}
            onChange={(event) => setElevationProvider(event.target.value as ProviderSelectValue)}
            className={`w-full rounded-md px-2 py-1 text-xs border ${
              mode === "simple"
                ? "bg-white border-slate-300 text-slate-900"
                : "bg-[#111827] border-slate-700 text-slate-100"
            }`}
          >
            <option value="default">Auto (default chain)</option>
            {providerOptions.map((provider) => (
              <option key={provider} value={provider}>
                {PROVIDER_LABELS[provider]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-[11px] uppercase tracking-wide opacity-80">Dataset</label>
          <select
            value={elevationDataset}
            onChange={(event) => setElevationDataset(event.target.value)}
            disabled={elevationProvider === "default" || datasetOptions.length === 0}
            className={`w-full rounded-md px-2 py-1 text-xs border disabled:opacity-50 disabled:cursor-not-allowed ${
              mode === "simple"
                ? "bg-white border-slate-300 text-slate-900"
                : "bg-[#111827] border-slate-700 text-slate-100"
            }`}
          >
            <option value="default">
              {elevationProvider === "default"
                ? "Default chain selection"
                : datasetOptions.length
                ? "Default dataset"
                : "No dataset option"}
            </option>
            {datasetOptions.map((dataset) => (
              <option key={dataset.value} value={dataset.value}>
                {dataset.label}
              </option>
            ))}
          </select>
        </div>
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
        {isRunning ? "Analyzing..." : !aoi ? "Draw a path first" : "Run Analysis"}
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
            {[
              { color: "#4caf50", label: "Low" },
              { color: "#ffeb3b", label: "Medium" },
              { color: "#ff9800", label: "High" },
              { color: "#f44336", label: "Extreme" },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: color }} />
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasResults && !isRunning && (
        <div className={`mt-auto text-xs ${mode === "simple" ? "text-slate-600" : "text-slate-400"}`}>
          Click <strong>Draw Path</strong> on the map, place points along the road, then hit
          <strong> Run Analysis</strong>.
        </div>
      )}
    </aside>
  );
}
