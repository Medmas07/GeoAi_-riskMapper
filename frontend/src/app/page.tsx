"use client";

import dynamic from "next/dynamic";
import Sidebar from "@/components/analysis/Sidebar";
import ImageViewer from "@/components/analysis/ImageViewer";
import ProfileChart from "@/components/analysis/ProfileChart";
import { useAnalysisStore } from "@/store/analysis";

const MapView = dynamic(() => import("@/components/map/MapView"), { ssr: false });

export default function Home() {
  const mode = useAnalysisStore((s) => s.mode);

  if (mode === "simple") {
    return (
      <main className="h-screen w-screen relative bg-slate-900">
        <MapView />
        <div className="absolute left-4 top-4 z-[700] w-[280px]">
          <Sidebar />
        </div>
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
      <div className="border-b border-slate-800 min-w-0 min-h-0">
        <MapView />
      </div>
      <div className="col-span-2 min-w-0 min-h-0">
        <ProfileChart />
      </div>
    </main>
  );
}
