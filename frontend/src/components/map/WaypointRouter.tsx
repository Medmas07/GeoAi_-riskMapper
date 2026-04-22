"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import L from "leaflet";
import { useAnalysisStore } from "@/store/analysis";
import type { DrawnPathPoint } from "@/store/analysis";

interface Waypoint {
  latlng: L.LatLng;
  marker: L.Marker;
}

interface Segment {
  coords: L.LatLng[];
  polyline: L.Polyline;
}

async function fetchRoute(
  from: L.LatLng,
  to: L.LatLng,
  signal?: AbortSignal
): Promise<L.LatLng[] | null> {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    `?overview=full&geometries=geojson&steps=false`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.code !== "Ok") return null;
    const routeCoords: [number, number][] =
      data?.routes?.[0]?.geometry?.coordinates ?? [];
    return routeCoords.map(([lng, lat]) => L.latLng(lat, lng));
  } catch {
    return null;
  }
}

function makeWaypointIcon(index: number, isFirst: boolean) {
  const color = isFirst ? "#22d3ee" : "#f97316";
  const label = isFirst ? "A" : String.fromCharCode(65 + index);
  return L.divIcon({
    html: `
      <div style="
        width:28px;height:28px;border-radius:50% 50% 50% 0;
        background:${color};border:2px solid white;
        transform:rotate(-45deg);
        box-shadow:0 2px 8px rgba(0,0,0,0.5);
        display:flex;align-items:center;justify-content:center;
      ">
        <span style="transform:rotate(45deg);color:white;font-size:11px;font-weight:700;">${label}</span>
      </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    className: "",
  });
}

interface WaypointRouterProps {
  mapRef: React.RefObject<L.Map | null>;
}

export default function WaypointRouter({ mapRef }: WaypointRouterProps) {
  const setAOI = useAnalysisStore((s) => s.setAOI);
  const setDrawnPath = useAnalysisStore((s) => s.setDrawnPath);

  const [active, setActive] = useState(false);
  const [waypointCount, setWaypointCount] = useState(0);
  const [isRouting, setIsRouting] = useState(false);

  const activeRef = useRef(false);
  const waypoints = useRef<Waypoint[]>([]);
  const segments = useRef<Segment[]>([]);
  const routeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // ── Commit ────────────────────────────────────────────────────────────────

  const commitPath = useCallback(() => {
    const allCoords: L.LatLng[] = [];
    for (const seg of segments.current) {
      const start = allCoords.length === 0 ? 0 : 1;
      allCoords.push(...seg.coords.slice(start));
    }
    if (allCoords.length < 2) {
      console.warn("[WaypointRouter] commitPath: not enough coords", allCoords.length);
      return;
    }

    const path: DrawnPathPoint[] = allCoords.map((ll) => ({
      lat: ll.lat,
      lon: ll.lng,
    }));

    // Safe min/max using reduce — avoids stack overflow on large arrays
    let minLat = path[0].lat, maxLat = path[0].lat;
    let minLon = path[0].lon, maxLon = path[0].lon;
    for (const p of path) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }

    console.log("[WaypointRouter] committing path:", path.length, "points, AOI:", { minLat, maxLat, minLon, maxLon });

    setDrawnPath(path);
    setAOI({
      south: minLat,
      north: maxLat,
      west: minLon,
      east: maxLon,
    });
  }, [setDrawnPath, setAOI]);

  // ── Clear ─────────────────────────────────────────────────────────────────

  const clearAll = useCallback(
    (alsoStore = true) => {
      for (const wp of waypoints.current) wp.marker.remove();
      for (const seg of segments.current) seg.polyline.remove();
      waypoints.current = [];
      segments.current = [];
      setWaypointCount(0);
      if (alsoStore) {
        setDrawnPath(null);
        setAOI(null);
      }
    },
    [setDrawnPath, setAOI]
  );

  // ── Finish ────────────────────────────────────────────────────────────────

  const finish = useCallback(
    (cancel = false) => {
      const map = mapRef.current;

      if (cancel) {
        clearAll(true);
      } else {
        commitPath();
        for (const wp of waypoints.current) wp.marker.remove();
        waypoints.current = [];
        setWaypointCount(0);
      }

      if (map) map.getContainer().style.cursor = "";
      setActive(false);
    },
    [mapRef, clearAll, commitPath]
  );

  // ── Undo ──────────────────────────────────────────────────────────────────

  const undo = useCallback(() => {
    if (waypoints.current.length === 0) return;
    const lastWp = waypoints.current.pop()!;
    lastWp.marker.remove();
    if (segments.current.length > 0) {
      const lastSeg = segments.current.pop()!;
      lastSeg.polyline.remove();
    }
    setWaypointCount(waypoints.current.length);
    commitPath();
  }, [commitPath]);

  // ── Add waypoint ──────────────────────────────────────────────────────────

  const addWaypoint = useCallback(
    async (latlng: L.LatLng) => {
      const map = mapRef.current;
      if (!map) {
        console.warn("[WaypointRouter] addWaypoint: map not ready");
        return;
      }

      const index = waypoints.current.length;
      const marker = L.marker(latlng, {
        icon: makeWaypointIcon(index, index === 0),
        draggable: false,
        zIndexOffset: 1000,
      }).addTo(map);

      waypoints.current.push({ latlng, marker });
      setWaypointCount(waypoints.current.length);

      if (waypoints.current.length === 1) return;

      const prev = waypoints.current[waypoints.current.length - 2].latlng;
      routeAbortRef.current?.abort();
      const controller = new AbortController();
      routeAbortRef.current = controller;

      setIsRouting(true);
      // Small delay so we don't hit OSRM right after preview requests
      await new Promise((r) => setTimeout(r, 700));
      const routeCoords = controller.signal.aborted ? null : await fetchRoute(prev, latlng, controller.signal);
      setIsRouting(false);

      if (controller.signal.aborted) return;

      // Always fall back to straight line if OSRM fails or rate-limits
      const coords = routeCoords && routeCoords.length >= 2 ? routeCoords : [prev, latlng];

      const polyline = L.polyline(coords, {
        color: "#00f3ff",
        weight: 4,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
        className: "path-glow-animation",
      }).addTo(map);

      segments.current.push({ coords, polyline });
      commitPath();
    },
    [mapRef, commitPath]
  );

  // ── Map events ────────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onClick = (e: L.LeafletMouseEvent) => {
      if (!activeRef.current) return;
      void addWaypoint(e.latlng);
    };
    const onDblClick = (e: L.LeafletMouseEvent) => {
      if (!activeRef.current) return;
      L.DomEvent.stop(e);
      finish(false);
    };

    map.on("click", onClick);
    map.on("dblclick", onDblClick);

    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDblClick);
    };
  }, [mapRef, addWaypoint, finish]);

  // ── Keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (e.key === "Enter") { e.preventDefault(); finish(false); }
      if (e.key === "Escape") { e.preventDefault(); finish(true); }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [finish, undo]);

  // ── Toggle ────────────────────────────────────────────────────────────────

  const toggle = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (active) {
      finish(false);
    } else {
      clearAll(true);
      map.getContainer().style.cursor = "crosshair";
      setActive(true);
    }
  }, [active, mapRef, finish, clearAll]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        title={active ? "Finish route (Enter) or double-click map" : "Route path along roads"}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold shadow-lg transition-all ${
          active
            ? "bg-cyan-400 text-black ring-2 ring-cyan-300"
            : "bg-black/70 text-white hover:bg-black/85"
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
          <path fillRule="evenodd" d="M12 1.586l-4 4v12.828l4-4V1.586zM3.707 3.293A1 1 0 002 4v10a1 1 0 00.293.707L6 18.414V5.586L3.707 3.293zM17.707 5.293L14 1.586v12.828l2.293 2.293A1 1 0 0018 16V6a1 1 0 00-.293-.707z" clipRule="evenodd" />
        </svg>
        {active
          ? isRouting ? "Routing…" : `${waypointCount} point${waypointCount !== 1 ? "s" : ""}`
          : "Route Path"}
      </button>

      {active && (
        <>
          {waypointCount >= 2 && (
            <button
              type="button"
              onClick={() => finish(false)}
              title="Finish route (Enter)"
              className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-black shadow-lg transition-all hover:bg-cyan-400"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Finish
            </button>
          )}

          {waypointCount >= 1 && (
            <button
              type="button"
              onClick={undo}
              title="Undo last point (Ctrl+Z)"
              className="flex items-center gap-1.5 rounded-lg bg-black/70 px-3 py-2 text-xs font-semibold text-white shadow-lg hover:bg-black/85 hover:text-cyan-400"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Undo
            </button>
          )}

          <button
            type="button"
            onClick={() => finish(true)}
            title="Cancel (Esc)"
            className="flex items-center gap-1.5 rounded-lg bg-black/70 px-3 py-2 text-xs font-semibold text-white/60 shadow-lg hover:bg-black/85 hover:text-red-400"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Cancel
          </button>
        </>
      )}
    </div>
  );
}