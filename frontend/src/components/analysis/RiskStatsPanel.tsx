"use client";

import { useAnalysisStore } from "@/store/analysis";

function StatCard({
  label,
  value,
  unit,
  accent,
  bar,
  na,
}: {
  label: string;
  value: string | number;
  unit?: string;
  accent: "cyan" | "orange" | "sky" | "green" | "red" | "amber";
  bar?: number;
  na?: boolean;
}) {
  const colors: Record<string, string> = {
    cyan:   "text-cyan-300   border-cyan-400/20   bg-cyan-400/10",
    orange: "text-orange-300 border-orange-400/20 bg-orange-400/10",
    sky:    "text-sky-300    border-sky-400/20    bg-sky-400/10",
    green:  "text-green-300  border-green-400/20  bg-green-400/10",
    red:    "text-red-300    border-red-400/20    bg-red-400/10",
    amber:  "text-amber-300  border-amber-400/20  bg-amber-400/10",
  };
  const barColors: Record<string, string> = {
    cyan: "bg-cyan-400", orange: "bg-orange-400", sky: "bg-sky-400",
    green: "bg-green-400", red: "bg-red-400", amber: "bg-amber-400",
  };

  return (
    <div className={`flex flex-col rounded-lg border px-2.5 py-2 ${colors[accent]} ${na ? "opacity-40" : ""}`}>
      <span className="text-[9px] font-semibold uppercase tracking-[0.14em] opacity-70">{label}</span>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="font-mono text-sm font-bold leading-none">
          {na ? "—" : value}
        </span>
        {!na && unit && <span className="text-[9px] opacity-60">{unit}</span>}
      </div>
      {!na && bar !== undefined && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColors[accent]}`}
            style={{ width: `${Math.round(Math.min(Math.max(bar, 0), 1) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function SectionHeader({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <div className={`mb-2 flex items-center gap-1.5 ${color}`}>
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-[0.16em]">{label}</span>
    </div>
  );
}

export default function RiskStatsPanel() {
  const floodLayers = useAnalysisStore((s) => s.floodLayers);
  const heatLayers  = useAnalysisStore((s) => s.heatLayers);

  const hasFlood = floodLayers.length > 0;
  const hasHeat  = heatLayers.length > 0;

  if (!hasFlood && !hasHeat) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-slate-600">
        Run analysis to see risk statistics
      </div>
    );
  }

  // Use whichever layer set is available; fall back to empty object
  const fc = ((hasFlood ? floodLayers[0] : heatLayers[0])?.components ?? {}) as Record<string, number>;
  const hc = ((hasHeat  ? heatLayers[0]  : floodLayers[0])?.components ?? {}) as Record<string, number>;

  // ── Heat values ──────────────────────────────────────────────────────────────
  const meanTemp      = hasHeat ? Number(hc.mean_temp_c        ?? 0) : null;
  const heatStress    = hasHeat ? Number(hc.heat_stress_score  ?? 0) : null;
  const uhiProxy      = hasHeat ? Number(hc.uhi_proxy          ?? 0) : null;
  const vegCoverage   = hasHeat ? Number(hc.vegetation_coverage ?? 0) : null;
  const shadowCov     = hasHeat ? Number(hc.shadow_coverage    ?? 0) : null;
  const uhiIntensity  = hasHeat ? Number(hc.uhi_intensity_c    ?? 0) : null;
  const heatIndex     = hasHeat ? Number(hc.heat_index_c       ?? meanTemp ?? 0) : null;
  const coolingDef    = hasHeat ? Number(hc.cooling_deficit    ?? 0) : null;
  const highHeatPct   = hasHeat ? Number(hc.high_heat_pct      ?? 0) : null;

  // ── Hydraulic values ─────────────────────────────────────────────────────────
  const totalRain     = hasFlood ? Number(fc.total_rainfall_mm    ?? 0) : null;
  const peakIntensity = hasFlood ? Number(fc.peak_intensity_mm_hr ?? 0) : null;
  const runoffCoeff   = hasFlood ? Number(fc.runoff_coefficient   ?? 0) : null;
  const peakFlowIdx   = hasFlood ? Number(fc.peak_flow_index      ?? 0) : null;
  const drainageIdx   = hasFlood ? Number(fc.drainage_index       ?? 0) : null;
  const meanSlope     = hasFlood ? Number(fc.mean_slope_deg       ?? 0) : null;
  const standingWater = hasFlood ? Number(fc.standing_water_pct   ?? 0) : null;
  const highRiskPct   = hasFlood ? Number(fc.high_risk_pct        ?? 0) : null;
  const meanFloodScore = hasFlood ? Number(fc.mean_flood_score    ?? 0) : null;

  function fmt(v: number | null, decimals = 1): string {
    return v == null ? "—" : v.toFixed(decimals);
  }
  function pct(v: number | null): string {
    return v == null ? "—" : `${Math.round(v * 100)}%`;
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Heat Analytics ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto border-r border-white/[0.06] p-3">
        <SectionHeader
          color="text-orange-400"
          label="Heat Analytics"
          icon={
            <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="7" cy="7" r="3.5" />
              <path d="M7 1v1M7 12v1M1 7h1M12 7h1M3 3l.7.7M10.3 10.3l.7.7M3 11l.7-.7M10.3 3.7l.7-.7" strokeLinecap="round" />
            </svg>
          }
        />
        {!hasHeat && (
          <p className="mb-2 rounded border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[9px] text-amber-400">
            Heat layers not generated — re-run analysis
          </p>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <StatCard label="Avg Temp"     value={fmt(meanTemp)}     unit="°C"  accent="orange" na={!hasHeat} />
          <StatCard label="Heat Index"   value={fmt(heatIndex)}    unit="°C"  accent="red"    na={!hasHeat} />
          <StatCard label="Heat Stress"  value={pct(heatStress)}              accent="amber"  bar={heatStress ?? 0} na={!hasHeat} />
          <StatCard label="UHI +ΔT"     value={`+${fmt(uhiIntensity)}`} unit="°C" accent="orange" na={!hasHeat} />
          <StatCard label="Vegetation"   value={pct(vegCoverage)}             accent="green"  bar={vegCoverage ?? 0}  na={!hasHeat} />
          <StatCard label="Shadow"       value={pct(shadowCov)}               accent="sky"    bar={shadowCov ?? 0}    na={!hasHeat} />
          <StatCard label="UHI Proxy"    value={pct(uhiProxy)}                accent="orange" bar={uhiProxy ?? 0}     na={!hasHeat} />
          <StatCard label="Cooling Gap"  value={pct(coolingDef)}              accent="red"    bar={coolingDef ?? 0}   na={!hasHeat} />
          <StatCard label="High Heat"    value={pct(highHeatPct)}             accent="amber"  bar={highHeatPct ?? 0}  na={!hasHeat} />
        </div>
      </div>

      {/* ── Hydraulic Info ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3">
        <SectionHeader
          color="text-sky-400"
          label="Hydraulic Info"
          icon={
            <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M1 10c1-2 2-3 3-3s2 2 3 2 2-2 3-2" strokeLinecap="round" />
              <path d="M1 7c1-2 2-3 3-3s2 2 3 2 2-2 3-2"  strokeLinecap="round" />
              <path d="M1 13c1-2 2-3 3-3s2 2 3 2 2-2 3-2" strokeLinecap="round" />
            </svg>
          }
        />
        {!hasFlood && (
          <p className="mb-2 rounded border border-sky-400/20 bg-sky-400/10 px-2 py-1 text-[9px] text-sky-400">
            Flood layers not generated — re-run analysis
          </p>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <StatCard label="Rainfall"      value={fmt(totalRain, 0)}      unit="mm"    accent="sky"  na={!hasFlood} />
          <StatCard label="Peak Intens."  value={fmt(peakIntensity)}     unit="mm/hr" accent="cyan" na={!hasFlood} />
          <StatCard label="Runoff Coeff"  value={fmt(runoffCoeff, 2)}                accent="cyan" bar={runoffCoeff ?? 0}   na={!hasFlood} />
          <StatCard label="Peak Flow Idx" value={fmt(peakFlowIdx, 3)}                accent="sky"  bar={Math.min(peakFlowIdx ?? 0, 1)} na={!hasFlood} />
          <StatCard label="Drainage Idx"  value={fmt(drainageIdx, 2)}               accent="cyan" bar={drainageIdx ?? 0}   na={!hasFlood} />
          <StatCard label="Mean Slope"    value={fmt(meanSlope)}         unit="°"    accent="amber" na={!hasFlood} />
          <StatCard label="Standing H₂O" value={pct(standingWater)}                 accent="sky"  bar={standingWater ?? 0} na={!hasFlood} />
          <StatCard label="High Risk Zone" value={pct(highRiskPct)}                 accent="red"  bar={highRiskPct ?? 0}   na={!hasFlood} />
        </div>

        {hasFlood && meanFloodScore != null && (
          <div className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">Flood Risk Score</span>
              <span className="font-mono text-xs font-bold text-cyan-300">{Math.round(meanFloodScore * 100)}%</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-500 transition-all duration-700"
                style={{ width: `${Math.round(meanFloodScore * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
