"use client";

import { useEffect, useRef, useState } from "react";
import { useAnalysisStore } from "@/store/analysis";

function clampIndex(index: number, len: number) {
  if (len <= 0) return 0;
  if (index < 0) return 0;
  if (index >= len) return len - 1;
  return index;
}

// ── Segmentation overlay ──────────────────────────────────────────────────────

function SegOverlay({
  vegPct,
  impPct,
  waterPct,
}: {
  vegPct: number;
  impPct: number;
  waterPct: number;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-none">
      {/* Vegetation — left green band */}
      <div
        className="absolute left-0 top-0 h-full transition-all duration-700"
        style={{
          width: `${Math.round(vegPct * 100)}%`,
          background: "linear-gradient(to right, rgba(34,197,94,0.72), rgba(34,197,94,0.18))",
          boxShadow: "inset -8px 0 16px rgba(34,197,94,0.2)",
        }}
      />
      {/* Impervious — right orange band */}
      <div
        className="absolute right-0 top-0 h-full transition-all duration-700"
        style={{
          width: `${Math.round(impPct * 100)}%`,
          background: "linear-gradient(to left, rgba(251,146,60,0.72), rgba(251,146,60,0.18))",
          boxShadow: "inset 8px 0 16px rgba(251,146,60,0.2)",
        }}
      />
      {/* Water — bottom blue band */}
      {waterPct > 0.04 && (
        <div
          className="absolute bottom-0 left-0 right-0 transition-all duration-700"
          style={{
            height: `${Math.round(Math.min(waterPct * 3, 0.45) * 100)}%`,
            background: "linear-gradient(to top, rgba(56,189,248,0.80), rgba(56,189,248,0.15))",
          }}
        />
      )}
      {/* Grid */}
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,1) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(34,211,238,1) 1px, transparent 1px)",
          backgroundSize: "20% 20%",
        }}
      />
      {/* Legend pills */}
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        {vegPct > 0.05 && (
          <div className="flex items-center gap-1 rounded border border-green-400/30 bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
            <span className="h-2 w-2 rounded-sm bg-green-400" />
            <span className="font-mono text-[9px] font-bold text-green-300">
              VEG {Math.round(vegPct * 100)}%
            </span>
          </div>
        )}
        {impPct > 0.05 && (
          <div className="flex items-center gap-1 rounded border border-orange-400/30 bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
            <span className="h-2 w-2 rounded-sm bg-orange-400" />
            <span className="font-mono text-[9px] font-bold text-orange-300">
              IMP {Math.round(impPct * 100)}%
            </span>
          </div>
        )}
        {waterPct > 0.04 && (
          <div className="flex items-center gap-1 rounded border border-sky-400/30 bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
            <span className="h-2 w-2 rounded-sm bg-sky-400" />
            <span className="font-mono text-[9px] font-bold text-sky-300">
              H₂O {Math.round(waterPct * 100)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Scan animation ────────────────────────────────────────────────────────────

function ScanAnimation() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-black/25" />
      {/* Scan line */}
      <div className="absolute left-0 right-0 h-[2px] animate-scan-line bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_14px_4px_rgba(34,211,238,0.7)]" />
      {/* Grid */}
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,1) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(34,211,238,1) 1px, transparent 1px)",
          backgroundSize: "16.666% 16.666%",
        }}
      />
      {/* Corner brackets */}
      {(["top-2 left-2 border-t-2 border-l-2", "top-2 right-2 border-t-2 border-r-2",
         "bottom-2 left-2 border-b-2 border-l-2", "bottom-2 right-2 border-b-2 border-r-2"] as const
      ).map((cls, i) => (
        <div key={i} className={`absolute h-4 w-4 border-cyan-400/80 ${cls}`} />
      ))}
      {/* Center label */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-cyan-400/40 bg-black/70 px-4 py-2 text-center backdrop-blur-sm">
        <p className="animate-pulse text-[9px] font-bold uppercase tracking-[0.25em] text-cyan-400">
          Segmenting…
        </p>
        <p className="mt-0.5 text-[8px] text-slate-400">SegFormer · Cityscapes</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ImageViewer() {
  const images = useAnalysisStore((s) => s.images);
  const currentIndex = useAnalysisStore((s) => s.currentIndex);
  const isPlaying = useAnalysisStore((s) => s.isPlaying);
  const isRunning = useAnalysisStore((s) => s.isRunning);
  const floodLayers = useAnalysisStore((s) => s.floodLayers);
  const heatLayers = useAnalysisStore((s) => s.heatLayers);
  const setIndex = useAnalysisStore((s) => s.setIndex);
  const next = useAnalysisStore((s) => s.next);
  const prev = useAnalysisStore((s) => s.prev);
  const play = useAnalysisStore((s) => s.play);
  const pause = useAnalysisStore((s) => s.pause);

  // Vision scores from analysis pipeline
  const fc = (floodLayers[0]?.components ?? {}) as Record<string, number>;
  const hc = (heatLayers[0]?.components ?? {}) as Record<string, number>;
  const vegPct = Number(hc.vegetation_coverage ?? 0.2);
  const impPct = Number(fc.vision_impervious ?? 0.5);
  const waterPct = Number(fc.standing_water_pct ?? 0.0);
  const hasResults = floodLayers.length > 0;

  // Segmentation state: idle | scanning | overlay
  const [segState, setSegState] = useState<"idle" | "scanning" | "overlay">("idle");

  // Reset when new analysis runs
  useEffect(() => {
    if (isRunning) setSegState("idle");
  }, [isRunning]);

  function handleSegmentClick() {
    if (segState === "overlay") { setSegState("idle"); return; }
    if (segState === "scanning") return;
    setSegState("scanning");
    setTimeout(() => setSegState("overlay"), 2200);
  }

  // Crossfade
  const [displayedIndex, setDisplayedIndex] = useState(currentIndex);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (currentIndex === displayedIndex) return;
    setFading(true);
    const t = setTimeout(() => { setDisplayedIndex(currentIndex); setFading(false); }, 150);
    return () => clearTimeout(t);
  }, [currentIndex, displayedIndex]);

  const displayedImage = images[clampIndex(displayedIndex, images.length)];
  const displayedSrc = displayedImage?.url?.trim() || displayedImage?.thumb_url?.trim() || "";

  // Autoplay interval
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => { next(); }, 900);
    return () => window.clearInterval(timer);
  }, [isPlaying, next]);

  // Filmstrip auto-scroll
  const filmstripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filmstripRef.current || images.length === 0) return;
    const thumb = filmstripRef.current.children[currentIndex] as HTMLElement | undefined;
    thumb?.scrollIntoView({ inline: "center", behavior: "smooth", block: "nearest" });
  }, [currentIndex, images.length]);

  const active = images[clampIndex(currentIndex, images.length)];
  const imageSrc = active?.url?.trim() || active?.thumb_url?.trim() || "";
  const isEmpty = images.length === 0 || !imageSrc;

  return (
    <section className="flex h-full w-full flex-col bg-[#080e1c]">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <svg className="h-3.5 w-3.5 text-cyan-400" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="2" width="12" height="10" rx="1.5" />
            <circle cx="4.5" cy="5.5" r="1.2" />
            <path d="M1 9l3-3 3 3 2-2 4 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Street View
          </h2>
          {hasResults && (
            <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-cyan-400">
              AI Ready
            </span>
          )}
        </div>
        <span className="text-[11px] font-medium tabular-nums text-slate-500">
          {images.length ? `${currentIndex + 1} / ${images.length}` : "No images"}
        </span>
      </div>

      {/* Main image */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-slate-500">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="8" cy="10" r="2" />
                <path d="M3 16l4.5-5 4 4 3-3 4.5 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-400">No street images</p>
            <p className="text-xs text-slate-600">Mapillary coverage may be limited.</p>
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayedSrc}
              alt={displayedImage?.id ?? ""}
              className="h-full w-full object-cover transition-opacity duration-150"
              style={{ opacity: fading ? 0 : 1 }}
            />

            {/* Scan animation */}
            {segState === "scanning" && <ScanAnimation />}

            {/* Segmentation overlay */}
            {segState === "overlay" && (
              <SegOverlay vegPct={vegPct} impPct={impPct} waterPct={waterPct} />
            )}

            {/* Coordinate overlay */}
            {displayedImage && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent px-3 pb-2 pt-8">
                <div className="flex items-end justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
                    <span className="font-mono text-[10px] font-semibold text-cyan-300">
                      {displayedImage.lat.toFixed(5)}, {displayedImage.lon.toFixed(5)}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400">#{displayedIndex + 1}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-shrink-0 items-center gap-1.5 border-t border-white/[0.06] px-3 py-2">
        <button type="button" onClick={prev}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-400 transition hover:border-white/15 hover:text-slate-200">
          <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M9 2L4 7l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <button type="button" onClick={isPlaying ? pause : play}
          className={`flex h-7 w-7 items-center justify-center rounded-lg border transition ${
            isPlaying
              ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/15"
              : "border-white/[0.08] bg-white/[0.04] text-slate-400 hover:border-cyan-400/20 hover:text-cyan-300"
          }`}>
          {isPlaying ? (
            <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2.5" y="2" width="3" height="10" rx="0.8" />
              <rect x="8.5" y="2" width="3" height="10" rx="0.8" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="currentColor">
              <polygon points="3,1.5 12,7 3,12.5" />
            </svg>
          )}
        </button>

        <button type="button" onClick={next}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-400 transition hover:border-white/15 hover:text-slate-200">
          <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M5 2l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Segment button — only when analysis has results */}
        {hasResults && (
          <button
            type="button"
            onClick={handleSegmentClick}
            disabled={segState === "scanning"}
            title={segState === "overlay" ? "Hide segmentation" : "Show segmentation"}
            className={`ml-auto flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] transition-all ${
              segState === "overlay"
                ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-300"
                : segState === "scanning"
                ? "cursor-not-allowed border-cyan-400/20 bg-cyan-400/10 text-cyan-400/60"
                : "border-white/[0.08] bg-white/[0.04] text-slate-400 hover:border-cyan-400/30 hover:text-cyan-300"
            }`}
          >
            {/* Segmentation icon */}
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="1" y="1" width="4" height="4" rx="0.5" />
              <rect x="7" y="1" width="4" height="4" rx="0.5" />
              <rect x="1" y="7" width="4" height="4" rx="0.5" />
              <rect x="7" y="7" width="4" height="4" rx="0.5" />
            </svg>
            {segState === "scanning" ? "Scanning…" : segState === "overlay" ? "Seg ON" : "Segment"}
          </button>
        )}

        {!hasResults && (
          <button type="button" onClick={() => setIndex(0)} title="Reset"
            className="ml-auto flex h-7 items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 text-[10px] text-slate-500 transition hover:border-white/15 hover:text-slate-300">
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 6a4 4 0 1 1 1.2 2.8" strokeLinecap="round" />
              <path d="M2 3v3h3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Reset
          </button>
        )}
      </div>

      {/* Filmstrip */}
      {images.length > 0 && (
        <div ref={filmstripRef}
          className="no-scrollbar flex flex-shrink-0 gap-1 overflow-x-auto border-t border-white/[0.06] bg-black/40 px-2 py-1.5">
          {images.map((img, idx) => (
            <button key={img.id} type="button" onClick={() => setIndex(idx)}
              className={`relative h-10 w-14 flex-shrink-0 overflow-hidden rounded-md border-2 transition-all duration-150 ${
                idx === currentIndex
                  ? "border-cyan-400 opacity-100 shadow-[0_0_8px_rgba(34,211,238,0.5)]"
                  : "border-transparent opacity-40 hover:border-white/20 hover:opacity-70"
              }`}>
              {img.thumb_url || img.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img.thumb_url || img.url} alt={`Frame ${idx + 1}`}
                  className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-slate-800 text-[9px] text-slate-600">
                  {idx + 1}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
