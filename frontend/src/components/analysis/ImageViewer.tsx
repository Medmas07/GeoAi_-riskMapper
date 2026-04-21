"use client";

import { useEffect } from "react";
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

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      next();
    }, 900);
    return () => window.clearInterval(timer);
  }, [isPlaying, next]);

  return (
    <section className="h-full w-full bg-[#0f172a] text-slate-100 p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-cyan-300">Image Viewer</h2>
        <span className="text-xs text-slate-400">
          {images.length ? `${currentIndex + 1} / ${images.length}` : "No images"}
        </span>
      </div>

      <div className="flex-1 min-h-0 rounded-lg border border-slate-700 bg-black overflow-hidden">
        {active ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={active.url} alt={active.id} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full grid place-items-center text-sm text-slate-500">
            Run analysis to load images
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={prev}
          className="rounded bg-slate-800 px-2 py-2 text-sm hover:bg-slate-700"
        >
          Prev
        </button>
        <button
          type="button"
          onClick={next}
          className="rounded bg-slate-800 px-2 py-2 text-sm hover:bg-slate-700"
        >
          Next
        </button>
        <button
          type="button"
          onClick={isPlaying ? pause : play}
          className="rounded bg-cyan-500 px-2 py-2 text-sm text-black font-medium hover:bg-cyan-400"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => setIndex(0)}
          className="rounded bg-slate-800 px-2 py-2 text-sm hover:bg-slate-700"
        >
          Reset
        </button>
      </div>
    </section>
  );
}
