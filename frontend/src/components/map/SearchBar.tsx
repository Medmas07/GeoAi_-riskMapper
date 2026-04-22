"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAnalysisStore } from "@/store/analysis";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string]; // [south, north, west, east]
  type: string;
  class: string;
}

export default function SearchBar() {
  const flyTo = useAnalysisStore((s) => s.flyTo);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Search ──────────────────────────────────────────────────────────────────
  const search = useCallback(async (text: string) => {
    if (text.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const url =
        `https://nominatim.openstreetmap.org/search` +
        `?q=${encodeURIComponent(text)}` +
        `&format=json&addressdetails=0&limit=6&dedupe=1`;

      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "Accept-Language": "en" },
      });

      if (!res.ok) throw new Error("Nominatim error");
      const data: NominatimResult[] = await res.json();
      setResults(data);
      setIsOpen(data.length > 0);
      setActiveIndex(-1);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setResults([]);
        setIsOpen(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Debounce input ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void search(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  // ── Select a result ─────────────────────────────────────────────────────────
  const selectResult = useCallback(
    (result: NominatimResult) => {
      const lat = parseFloat(result.lat);
      const lon = parseFloat(result.lon);

      // Use bounding box to pick zoom level
      const [south, north, west, east] = result.boundingbox.map(parseFloat);
      const latSpan = north - south;
      const lonSpan = east - west;
      const span = Math.max(latSpan, lonSpan);

      // Heuristic: map degree span → zoom level
      let zoom = 13;
      if (span > 20) zoom = 4;
      else if (span > 10) zoom = 5;
      else if (span > 5) zoom = 6;
      else if (span > 2) zoom = 7;
      else if (span > 1) zoom = 9;
      else if (span > 0.5) zoom = 10;
      else if (span > 0.1) zoom = 12;
      else if (span > 0.02) zoom = 14;
      else zoom = 16;

      flyTo({ lat, lon, zoom });
      setQuery(result.display_name.split(",")[0]); // show just the primary name
      setIsOpen(false);
      setResults([]);
      inputRef.current?.blur();
    },
    [flyTo]
  );

  // ── Keyboard navigation ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        selectResult(results[activeIndex]);
      } else if (e.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    },
    [isOpen, activeIndex, results, selectResult]
  );

  // ── Close on outside click ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Trim long display names ─────────────────────────────────────────────────
  const formatName = (display: string) => {
    const parts = display.split(",");
    const primary = parts[0].trim();
    const secondary = parts.slice(1, 3).join(",").trim();
    return { primary, secondary };
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative w-72">
      {/* Input */}
      <div
        className={`flex items-center gap-2 rounded-xl border px-3 py-2 shadow-lg backdrop-blur-sm transition-all ${
          isOpen
            ? "border-cyan-400/60 bg-black/85"
            : "border-white/15 bg-black/70 hover:border-white/30"
        }`}
      >
        {/* Search icon */}
        {loading ? (
          <svg
            className="h-4 w-4 animate-spin text-cyan-400 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        ) : (
          <svg
            className="h-4 w-4 text-slate-400 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="8" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
          </svg>
        )}

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Search location…"
          className="flex-1 bg-transparent text-sm text-white placeholder-slate-400 outline-none"
        />

        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
              setIsOpen(false);
              inputRef.current?.focus();
            }}
            className="text-slate-400 hover:text-white transition-colors shrink-0"
            aria-label="Clear"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1.5 z-[800] rounded-xl border border-white/10 bg-black/90 py-1 shadow-2xl backdrop-blur-sm overflow-hidden">
          {results.map((result, i) => {
            const { primary, secondary } = formatName(result.display_name);
            return (
              <li key={result.place_id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent input blur before click
                    selectResult(result);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
                    activeIndex === i ? "bg-cyan-500/20" : "hover:bg-white/5"
                  }`}
                >
                  {/* Pin icon */}
                  <svg
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                  </svg>

                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">{primary}</div>
                    {secondary && (
                      <div className="truncate text-xs text-slate-400">{secondary}</div>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}