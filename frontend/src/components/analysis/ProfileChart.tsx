"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { useAnalysisStore } from "@/store/analysis";

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "cyan" | "amber" | "slate";
}) {
  const colors = {
    cyan: "text-cyan-300",
    amber: "text-amber-300",
    slate: "text-slate-300",
  };
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5">
      <span className={`text-sm font-bold tabular-nums leading-none ${colors[accent ?? "slate"]}`}>
        {value}
      </span>
      <span className="text-[9px] uppercase tracking-[0.12em] text-slate-600">{label}</span>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-[#060c18]/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {`${Number(label).toFixed(2)} km`}
      </p>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-xs">
          <span
            className="h-1.5 w-3 rounded-full"
            style={{ background: entry.color }}
          />
          <span className="text-slate-400 capitalize">
            {entry.dataKey === "elevation" ? "Elevation" : "Slope"}
          </span>
          <span className="ml-auto font-semibold tabular-nums" style={{ color: entry.color }}>
            {entry.dataKey === "elevation"
              ? `${Number(entry.value).toFixed(1)} m`
              : `${Number(entry.value).toFixed(2)} %`}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ProfileChart() {
  const profile = useAnalysisStore((s) => s.profile);
  const currentIndex = useAnalysisStore((s) => s.currentIndex);
  const setIndex = useAnalysisStore((s) => s.setIndex);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (profile.length === 0) {
    return (
      <section className="flex h-full w-full flex-col bg-[#080e1c]">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <svg className="h-3.5 w-3.5 text-cyan-400" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="1,10 4,6 7,8 10,3 13,5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Elevation Profile
            </h3>
          </div>
          <span className="text-[10px] text-slate-600">No data</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] text-slate-600">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
              <polyline points="2,15 6,9 10,12 14,5 18,8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-xs text-slate-500">
            Run analysis to generate elevation profile
          </p>
        </div>
      </section>
    );
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const data = profile.map((p, idx) => ({ ...p, idx, distanceKm: p.distance / 1000 }));
  const totalDist = (profile[profile.length - 1].distance / 1000).toFixed(2);
  const elevations = profile.map((p) => p.elevation);
  const minEle = Math.min(...elevations).toFixed(0);
  const maxEle = Math.max(...elevations).toFixed(0);
  const eleRange = `${minEle}–${maxEle} m`;
  const maxSlope = Math.max(...profile.map((p) => Math.abs(p.slope))).toFixed(1);

  return (
    <section className="flex h-full w-full flex-col bg-[#080e1c]">
      {/* Header + stats */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-2">
        <div className="flex items-center gap-2 mr-auto">
          <svg className="h-3.5 w-3.5 text-cyan-400" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="1,10 4,6 7,8 10,3 13,5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Elevation Profile
          </h3>
        </div>

        <StatPill label="Distance" value={`${totalDist} km`} accent="slate" />
        <StatPill label="Elevation" value={eleRange} accent="cyan" />
        <StatPill label="Max Slope" value={`${maxSlope}%`} accent="amber" />

        <span className="ml-2 text-[10px] tabular-nums text-slate-600">
          pt {currentIndex + 1}
        </span>
      </div>

      {/* Chart */}
      <div className="min-h-0 flex-1 px-2 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
            onMouseMove={(state) => {
              if (typeof state.activeTooltipIndex === "number") {
                setIndex(state.activeTooltipIndex);
              }
            }}
          >
            <defs>
              <linearGradient id="elevGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="1" />
              </linearGradient>
            </defs>

            <CartesianGrid
              stroke="rgba(30,41,59,0.8)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="distanceKm"
              tickFormatter={(v) => `${Number(v).toFixed(1)}km`}
              tick={{ fill: "#475569", fontSize: 10 }}
              stroke="transparent"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fill: "#475569", fontSize: 10 }}
              stroke="transparent"
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(255,255,255,0.06)", strokeWidth: 1 }} />

            <Line
              type="monotone"
              dataKey="elevation"
              stroke="url(#elevGrad)"
              strokeWidth={2}
              dot={false}
              isAnimationActive
              animationDuration={600}
              animationEasing="ease-out"
            />
            <Line
              type="monotone"
              dataKey="slope"
              stroke="#f59e0b"
              strokeWidth={1.5}
              dot={false}
              strokeOpacity={0.7}
              isAnimationActive
              animationDuration={800}
              animationEasing="ease-out"
            />
            <ReferenceLine
              x={data[currentIndex]?.distanceKm}
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeOpacity={0.8}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
