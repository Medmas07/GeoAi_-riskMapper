"use client";

import { useEffect, useRef, useState } from "react";
import { useAnalysisStore } from "@/store/analysis";

function clampIndex(index: number, len: number) {
  if (len <= 0) return 0;
  if (index < 0) return 0;
  if (index >= len) return len - 1;
  return index;
}

export default function ImageViewer() {
  const images = useAnalysisStore((s) => s.images);
  const currentIndex = useAnalysisStore((s) => s.currentIndex);
  const isPlaying = useAnalysisStore((s) => s.isPlaying);
  const setIndex = useAnalysisStore((s) => s.setIndex);
  const next = useAnalysisStore((s) => s.next);
  const prev = useAnalysisStore((s) => s.prev);
  const play = useAnalysisStore((s) => s.play);
  const pause = useAnalysisStore((s) => s.pause);

  const active = images[clampIndex(currentIndex, images.length)];
  const imageSrc = active?.url?.trim() || active?.thumb_url?.trim() || "";

  // ── Crossfade state ────────────────────────────────────────────────────────
  const [displayedIndex, setDisplayedIndex] = useState(currentIndex);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (currentIndex === displayedIndex) return;
    setFading(true);
    const t = setTimeout(() => {
      setDisplayedIndex(currentIndex);
      setFading(false);
    }, 150);
    return () => clearTimeout(t);
  }, [currentIndex, displayedIndex]);

  const displayedImage = images[clampIndex(displayedIndex, images.length)];
  const displayedSrc = displayedImage?.url?.trim() || displayedImage?.thumb_url?.trim() || "";

  // ── Playback interval ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => { next(); }, 900);
    return () => window.clearInterval(timer);
  }, [isPlaying, next]);

  // ── Filmstrip auto-scroll ──────────────────────────────────────────────────
  const filmstripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filmstripRef.current || images.length === 0) return;
    const thumb = filmstripRef.current.children[currentIndex] as HTMLElement | undefined;
    thumb?.scrollIntoView({ inline: "center", behavior: "smooth", block: "nearest" });
  }, [currentIndex, images.length]);

  const isEmpty = images.length === 0 || !imageSrc;

  return (
    <section className="flex h-full w-full flex-col bg-[#080e1c]">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
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
        </div>
        <span className="text-[11px] font-medium tabular-nums text-slate-500">
          {images.length ? `${currentIndex + 1} / ${images.length}` : "No images"}
        </span>
      </div>

      {/* ── Main image ─────────────────────────────────────────────────────── */}
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
            <div>
              <p className="text-sm font-medium text-slate-400">No street images</p>
              <p className="mt-1 text-xs text-slate-600">Mapillary coverage may be limited in this area.</p>
            </div>
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

            {/* Metadata overlay */}
            {displayedImage && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-3 pb-2 pt-8">
                <div className="flex items-end justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
                    <span className="font-mono text-[10px] font-semibold text-cyan-300">
                      {displayedImage.lat.toFixed(5)}, {displayedImage.lon.toFixed(5)}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    #{displayedIndex + 1}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Controls ───────────────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center gap-1.5 border-t border-white/[0.06] px-3 py-2">
        <button
          type="button"
          onClick={prev}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-400 transition hover:border-white/15 hover:text-slate-200"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M9 2L4 7l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <button
          type="button"
          onClick={isPlaying ? pause : play}
          className={`flex h-7 w-7 items-center justify-center rounded-lg border transition ${
            isPlaying
              ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/15"
              : "border-white/[0.08] bg-white/[0.04] text-slate-400 hover:border-cyan-400/20 hover:text-cyan-300"
          }`}
        >
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

        <button
          type="button"
          onClick={next}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-400 transition hover:border-white/15 hover:text-slate-200"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M5 2l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => setIndex(0)}
          title="Reset to start"
          className="ml-auto flex h-7 items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 text-[10px] text-slate-500 transition hover:border-white/15 hover:text-slate-300"
        >
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 6a4 4 0 1 1 1.2 2.8" strokeLinecap="round" />
            <path d="M2 3v3h3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Reset
        </button>
      </div>

      {/* ── Filmstrip ──────────────────────────────────────────────────────── */}
      {images.length > 0 && (
        <div
          ref={filmstripRef}
          className="no-scrollbar flex flex-shrink-0 gap-1 overflow-x-auto border-t border-white/[0.06] bg-black/40 px-2 py-1.5"
        >
          {images.map((img, idx) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setIndex(idx)}
              className={`relative h-10 w-14 flex-shrink-0 overflow-hidden rounded-md border-2 transition-all duration-150 ${
                idx === currentIndex
                  ? "border-cyan-400 opacity-100 shadow-[0_0_8px_rgba(34,211,238,0.5)]"
                  : "border-transparent opacity-40 hover:border-white/20 hover:opacity-70"
              }`}
            >
              {img.thumb_url || img.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={img.thumb_url || img.url}
                  alt={`Frame ${idx + 1}`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
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
