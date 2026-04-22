"use client";
import { useRef, useCallback, useState } from "react";
import dynamic from "next/dynamic";
import type L from "leaflet";
import Sidebar from "@/components/analysis/Sidebar";
import ImageViewer from "@/components/analysis/ImageViewer";
import ProfileChart from "@/components/analysis/ProfileChart";
import SearchBar from "@/components/map/SearchBar";
import { useAnalysisStore } from "@/store/analysis";

const MapView = dynamic(() => import("@/components/map/MapView"), { ssr: false });
const WaypointRouter = dynamic(() => import("@/components/map/WaypointRouter"), { ssr: false });

export default function Home() {
  const mode = useAnalysisStore((s) => s.mode);

  const leafletMapRef = useRef<L.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const handleMapReady = useCallback((map: L.Map) => {
    leafletMapRef.current = map;
    setMapReady(true);
  }, []);

  if (mode === "simple") {
    return (
      <main className="h-screen w-screen relative bg-slate-900">
        <MapView onMapReady={handleMapReady} />

        <div className="absolute left-4 top-4 z-[700] w-[280px]">
          <Sidebar />
        </div>

        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[700]">
          <SearchBar />
        </div>

        {mapReady && (
          <div className="absolute top-16 right-3 z-[560]">
            <WaypointRouter mapRef={leafletMapRef} />
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="grid grid-cols-[300px_1fr_1fr] grid-rows-[1fr_240px] h-screen bg-[#0b0f1a] text-slate-100">
      <div className="row-span-2 border-r border-slate-800 min-h-0">
        <Sidebar />
      </div>
      <div className="border-b border-r border-slate-800 min-w-0 min-h-0">
        <ImageViewer />
      </div>
      <div className="border-b border-slate-800 min-w-0 min-h-0 relative">
        <MapView onMapReady={handleMapReady} />
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[700]">
          <SearchBar />
        </div>
        {mapReady && (
          <div className="absolute top-16 right-3 z-[560]">
            <WaypointRouter mapRef={leafletMapRef} />
          </div>
        )}
      </div>
      <div className="col-span-2 min-w-0 min-h-0">
        <ProfileChart />
      </div>
    </main>
  );
}