"use client";

import { useMemo } from "react";
import { useAnalysisStore } from "@/store/analysis";
import { api } from "@/lib/api";

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
  const setData = useAnalysisStore((s) => s.setData); // Added setData

  const hasResults = floodLayers.length > 0;

  const aoiLabel = useMemo(() => {
    if (!aoi) return "No AOI selected";
    return `${aoi.south.toFixed(4)}, ${aoi.west.toFixed(4)} → ${aoi.north.toFixed(4)}, ${aoi.east.toFixed(4)}`;
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
      
      if (result.status === "completed") {
        setRiskResults(result.flood_layers, result.heat_layers);
        
        // Fetch real Mapillary images for the ImageViewer
        const imgs = await api.mapillary.images(
          aoi.west, aoi.south, aoi.east, aoi.north
        );

        const sortedImgs = imgs.length <= 1
          ? imgs
          : (() => {
              const sorted = [imgs[0]];
              const remaining = imgs.slice(1);

              while (remaining.length) {
                const last = sorted[sorted.length - 1];
                let nearestIdx = 0;
                let nearestDist = Infinity;

                remaining.forEach((img: any, i: number) => {
                  const d = Math.hypot(img.lat - last.lat, img.lon - last.lon);
                  if (d < nearestDist) {
                    nearestDist = d;
                    nearestIdx = i;
                  }
                });

                sorted.push(remaining.splice(nearestIdx, 1)[0]);
              }

              return sorted;
            })();
        
        setData({
          trajectory: sortedImgs.map((img: any) => ({
            lat: img.lat,
            lon: img.lon,
            elevation: 0,
            image_id: img.id,
          })),
          images: sortedImgs.map((img: any) => ({
            id: img.id,
            lat: img.lat,
            lon: img.lon,
            url: img.thumb_url ?? `https://picsum.photos/seed/${img.id}/1200/700`,
          })),
          profile: [],
        });
        console.log("images from mapillary:", imgs.length, imgs[0]);
        console.log("flood layers:", result.flood_layers.length);
        console.log("switching to advanced mode");

        setMode("advanced"); // Switch to advanced mode automatically
        
        // Quick fix: force map to fit by resetting and re-setting the AOI
        const currentAoi = aoi;
        setAOI(null);
        setTimeout(() => setAOI(currentAoi), 50);
        
      } else {
        alert(`Analysis failed: ${result.status}`);
      }
    } catch (e) {
      alert(`Error: ${e}`);
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
                    ? layer === "flood" ? "bg-blue-500 text-white" : "bg-orange-500 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                {layer}
              </button>
            ))}
          </div>
          <div className="text-xs space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm inline-block" style={{background:"#4caf50"}} />
              Low
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm inline-block" style={{background:"#ffeb3b"}} />
              Medium
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm inline-block" style={{background:"#ff9800"}} />
              High
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm inline-block" style={{background:"#f44336"}} />
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