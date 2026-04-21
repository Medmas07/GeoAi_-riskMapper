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

export default function ProfileChart() {
  const profile = useAnalysisStore((s) => s.profile);
  const currentIndex = useAnalysisStore((s) => s.currentIndex);
  const setIndex = useAnalysisStore((s) => s.setIndex);

  const data = profile.map((p, idx) => ({
    ...p,
    idx,
    distanceKm: p.distance / 1000,
  }));

  return (
    <section className="h-full w-full bg-[#0b1220] text-slate-100 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-cyan-300">Elevation Profile</h3>
        <span className="text-xs text-slate-400">
          {profile.length ? `Point ${currentIndex + 1}` : "No profile"}
        </span>
      </div>
      <div className="h-[calc(100%-28px)] w-full rounded-lg border border-slate-800 bg-[#0a0f1a] p-2">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              onMouseMove={(state) => {
                if (typeof state.activeTooltipIndex === "number") {
                  setIndex(state.activeTooltipIndex);
                }
              }}
            >
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis
                dataKey="distanceKm"
                tickFormatter={(v) => `${Number(v).toFixed(1)}km`}
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                stroke="#334155"
              />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} stroke="#334155" />
              <Tooltip
                formatter={(value: number, name: string) => [
                  name === "elevation" ? `${value.toFixed(1)} m` : `${value.toFixed(2)} %`,
                  name === "elevation" ? "Elevation" : "Slope",
                ]}
                labelFormatter={(label) => `Distance ${Number(label).toFixed(2)} km`}
                contentStyle={{
                  background: "#020617",
                  border: "1px solid #334155",
                  color: "#e2e8f0",
                }}
              />
              <Line type="monotone" dataKey="elevation" stroke="#38bdf8" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="slope" stroke="#f59e0b" strokeWidth={2} dot={false} />
              <ReferenceLine x={data[currentIndex]?.distanceKm} stroke="#ef4444" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full grid place-items-center text-sm text-slate-500">
            Run analysis to generate profile
          </div>
        )}
      </div>
    </section>
  );
}
