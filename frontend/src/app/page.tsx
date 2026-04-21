import ControlPanel from "@/components/analysis/ControlPanel";
import RiskMapClient from "@/components/map/RiskMapClient";

export default function Home() {
  return (
    <main className="flex h-screen w-screen overflow-hidden">
      <ControlPanel />
      <div className="flex-1 relative">
        <RiskMapClient />
      </div>
    </main>
  );
}
