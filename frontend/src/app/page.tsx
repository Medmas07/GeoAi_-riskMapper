"use client";
import { useRef, useCallback, useState } from "react";
import dynamic from "next/dynamic";
import type L from "leaflet";
import Sidebar from "@/components/analysis/Sidebar";
import ImageViewer from "@/components/analysis/ImageViewer";
import ProfileChart from "@/components/analysis/ProfileChart";
import RiskStatsPanel from "@/components/analysis/RiskStatsPanel";
import GeoAssistant from "@/components/assistant/GeoAssistant";
import SearchBar from "@/components/map/SearchBar";
import { useAnalysisStore } from "@/store/analysis";

const MapView = dynamic(() => import("@/components/map/MapView"), { ssr: false });
const WaypointRouter = dynamic(() => import("@/components/map/WaypointRouter"), { ssr: false });

// ── Icons ────────────────────────────────────────────────────────────────────

function IconGrid() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" rx="1" />
      <rect x="8" y="1" width="5" height="5" rx="1" />
      <rect x="1" y="8" width="5" height="5" rx="1" />
      <rect x="8" y="8" width="5" height="5" rx="1" />
    </svg>
  );
}

function IconMap() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="12" height="12" rx="2" />
      <circle cx="7" cy="7" r="2.5" />
    </svg>
  );
}

function IconBot() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="4" width="10" height="7" rx="2" />
      <circle cx="5" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <path d="M7 1v3" strokeLinecap="round" />
      <circle cx="7" cy="1" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ── Toolbar pill shared between modes ────────────────────────────────────────

function ToolbarBtn({
  active,
  onClick,
  children,
  label,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all duration-200 ${
        active
          ? "border-cyan-400/35 bg-cyan-400/12 text-cyan-300"
          : "border-white/10 bg-white/[0.04] text-slate-400 hover:border-cyan-400/25 hover:bg-cyan-400/[0.08] hover:text-cyan-300"
      }`}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

// ── Bottom panel ─────────────────────────────────────────────────────────────
// When results exist: ProfileChart left (60%) | RiskStatsPanel right (40%)
// Before results: ProfileChart full width

function BottomPanel() {
  const floodLayers = useAnalysisStore((s) => s.floodLayers);
  const hasResults = floodLayers.length > 0;

  return (
    <div className="col-span-2 flex min-h-0 min-w-0 overflow-hidden border-t-2 border-slate-700">
      {/* Elevation profile — always shown */}
      <div className={`min-h-0 min-w-0 overflow-hidden transition-all duration-500 ${hasResults ? "w-[60%] border-r border-white/[0.06]" : "w-full"}`}>
        <ProfileChart />
      </div>

      {/* Risk stats — slides in when results arrive */}
      {hasResults && (
        <div className="w-[40%] min-h-0 overflow-hidden bg-[#080e1c]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
            <svg className="h-3 w-3 text-cyan-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M1 10V5M4 10V3M7 10V6M10 10V1" strokeLinecap="round" />
            </svg>
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Risk Statistics</span>
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.9)]" />
          </div>
          <div className="h-[calc(100%-29px)] overflow-hidden">
            <RiskStatsPanel />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main layout ──────────────────────────────────────────────────────────────

export default function Home() {
  const mode = useAnalysisStore((s) => s.mode);
  const setMode = useAnalysisStore((s) => s.setMode);

  const leafletMapRef = useRef<L.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(true);

  const handleMapReady = useCallback((map: L.Map) => {
    leafletMapRef.current = map;
    setMapReady(true);
  }, []);

  // ── Simple mode ─────────────────────────────────────────────────────────────
  if (mode === "simple") {
    return (
      <main className="flex h-screen w-screen bg-slate-900 overflow-hidden">
        {/* Map area */}
        <div className="relative flex-1 min-w-0">
          <div className="absolute inset-0 z-0">
            <MapView onMapReady={handleMapReady} />
          </div>

          <div className="absolute left-4 top-4 z-[700] w-[300px] animate-slide-in-left">
            <Sidebar />
          </div>

          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[700]">
            <SearchBar />
          </div>

          {mapReady && (
            <div
              className="absolute top-[72px] z-[560] transition-all duration-300"
              style={{ right: assistantOpen ? 356 : 12 }}
            >
              <WaypointRouter mapRef={leafletMapRef} />
            </div>
          )}

            {/* Assistant toggle button on right edge of map */}
            <button
              type="button"
              onClick={() => setAssistantOpen((prev) => !prev)}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-[600] flex h-12 w-5 items-center justify-center rounded-l-lg bg-slate-800 border border-slate-700 border-r-0 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 transition-all"
              title={assistantOpen ? "Hide assistant" : "Show assistant"}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                {assistantOpen ? <path d="M3 1l4 4-4 4" /> : <path d="M7 1L3 5l4 4" />}
              </svg>
            </button>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[700] flex items-center gap-1 rounded-full border border-white/10 bg-black/55 px-2 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <ToolbarBtn onClick={() => setMode("advanced")} label="Advanced">
              <IconGrid />
            </ToolbarBtn>
            <div className="mx-0.5 h-4 w-px bg-white/10" />
            <ToolbarBtn
              active={assistantOpen}
              onClick={() => setAssistantOpen((p) => !p)}
              label="AI Assistant"
            >
              <IconBot />
            </ToolbarBtn>
          </div>
        </div>

        {/* Assistant panel */}
        <div className="h-full w-[340px] min-w-[340px] flex-shrink-0 border-l border-slate-800 flex flex-col">
          {assistantOpen ? (
            <GeoAssistant />
          ) : (
            <div className="flex h-full items-center justify-center bg-[#0a0e1a]">
              <button
                type="button"
                onClick={() => setAssistantOpen(true)}
                className="flex flex-col items-center gap-3 text-slate-500 hover:text-cyan-400 transition-colors p-6 rounded-xl hover:bg-white/5"
              >
                <span className="text-2xl">✦</span>
                <span className="text-xs font-medium tracking-widest uppercase">GeoAI</span>
                <span className="text-[10px] text-slate-600">Click to open</span>
              </button>
            </div>
          )}
        </div>
      </main>
    );
  }

  // ── Advanced mode ────────────────────────────────────────────────────────────
  return (
    <main
      className={`grid grid-rows-[1fr_260px] h-screen bg-[#0b0f1a] text-slate-100 transition-all ${
        assistantOpen ? "grid-cols-[300px_1fr_1fr_340px]" : "grid-cols-[300px_1fr_1fr]"
      }`}
    >
      {/* Col 1: Sidebar — row span 2 */}
      <div className="row-span-2 border-r border-slate-800 min-h-0 overflow-hidden">
        <Sidebar />
      </div>

      {/* Col 2: ImageViewer — row 1 */}
      <div className="border-b border-r border-slate-800 min-w-0 min-h-0 overflow-hidden">
        <ImageViewer />
      </div>

      {/* Col 3: Map — row 1 */}
      <div className="border-b border-r border-slate-800 min-w-0 min-h-0 relative overflow-hidden">
        <MapView onMapReady={handleMapReady} />

        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[700]">
          <SearchBar />
        </div>

        {mapReady && (
          <div className="absolute top-[60px] right-3 z-[560]">
            <WaypointRouter mapRef={leafletMapRef} />
          </div>
        )}

        {/* Assistant toggle button on right edge of map */}
        <button
          type="button"
          onClick={() => setAssistantOpen((prev) => !prev)}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-[600] flex h-12 w-5 items-center justify-center rounded-l-lg bg-slate-800 border border-slate-700 border-r-0 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 transition-all"
          title={assistantOpen ? "Hide assistant" : "Show assistant"}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            {assistantOpen ? <path d="M3 1l4 4-4 4" /> : <path d="M7 1L3 5l4 4" />}
          </svg>
        </button>
      </div>

      {/* Col 4: GeoAssistant — row span 2, aligned from very top */}
      <div className={`row-span-2 border-l border-slate-800 min-h-0 overflow-hidden flex flex-col transition-all ${assistantOpen ? "w-[340px]" : "w-0 border-l-0"}`}>
        {assistantOpen && <GeoAssistant />}
      </div>

      {/* Col 2-3: Bottom panel — row 2, spans cols 2 and 3 */}
      <BottomPanel />

    </main>
  );
}
