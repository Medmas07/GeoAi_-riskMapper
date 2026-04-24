"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAnalysisStore, type AssistantWaypoint, type TrajectoryPoint } from "@/store/analysis";
import { RISK_COLORS, type RiskCategory } from "@/types";

type Basemap = "osm" | "satellite" | "terrain";

const TILE_URL: Record<Basemap, string> = {
  osm: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  satellite:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  terrain: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
};

const ATTRIBUTION: Record<Basemap, string> = {
  osm: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  satellite:
    "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  terrain:
    '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> contributors',
};

// ---------------------------------------------------------------------------
// Nearest trajectory index for click-to-seek
// ---------------------------------------------------------------------------
function nearestTrajectoryIndex(
  points: TrajectoryPoint[],
  lat: number,
  lon: number
) {
  if (!points.length) return 0;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i++) {
    const dLat = points[i].lat - lat;
    const dLon = points[i].lon - lon;
    const d2 = dLat * dLat + dLon * dLon;
    if (d2 < bestDistance) {
      bestDistance = d2;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function clampIndex(index: number, len: number) {
  if (len <= 0) return 0;
  if (index < 0) return 0;
  if (index >= len) return len - 1;
  return index;
}

interface MapViewProps {
  onMapReady?: (map: L.Map) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function MapView({ onMapReady }: MapViewProps) {
  const mode = useAnalysisStore((s) => s.mode);
  const trajectory = useAnalysisStore((s) => s.trajectory);
  const images = useAnalysisStore((s) => s.images);
  const currentIndex = useAnalysisStore((s) => s.currentIndex);
  const setIndex = useAnalysisStore((s) => s.setIndex);
  const aoi = useAnalysisStore((s) => s.aoi);
  const setAOI = useAnalysisStore((s) => s.setAOI);
  const setDrawnPath = useAnalysisStore((s) => s.setDrawnPath);
  const assistantWaypoints = useAnalysisStore((s) => s.assistantWaypoints);
  const assistantRoute = useAnalysisStore((s) => s.assistantRoute);

  const floodLayers = useAnalysisStore((s) => s.floodLayers);
  const heatLayers = useAnalysisStore((s) => s.heatLayers);
  const activeLayer = useAnalysisStore((s) => s.activeLayer);

  // Fly to target from store
  const flyToTarget = useAnalysisStore((s) => s.flyToTarget);
  const clearFlyTo = useAnalysisStore((s) => s.clearFlyTo);

  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const assistantRouteLineRef = useRef<L.Polyline | null>(null);
  const assistantMarkersRef = useRef<L.Marker[]>([]);
  const aoiRectRef = useRef<L.Rectangle | null>(null);
  const riskLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  const pointsRef = useRef<TrajectoryPoint[]>([]);

  const [basemap, setBasemap] = useState<Basemap>("osm");
  const [mapReady, setMapReady] = useState(false);

  const activeImage = images[clampIndex(currentIndex, images.length)];
  const mapPinIcon = useMemo(
    () =>
      L.divIcon({
        html: `
          <svg class="map-pin-svg" aria-hidden="true" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="pinFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#ff7a6a" />
                <stop offset="100%" stop-color="#d83c30" />
              </linearGradient>
              <radialGradient id="pinGlow" cx="50%" cy="40%" r="60%">
                <stop offset="0%" stop-color="#ffffff" stop-opacity="0.26" />
                <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
              </radialGradient>
            </defs>
            <ellipse cx="16" cy="37" rx="6.2" ry="1.8" fill="#000000" opacity="0.16"/>
            <path d="M16 39.5c5.2-6.8 8.4-12 8.4-18.1C24.4 14 20.8 9.8 16 9.8S7.6 14 7.6 21.4C7.6 27.5 10.8 32.7 16 39.5Z" fill="url(#pinFill)" stroke="#fff7f4" stroke-width="1.2" stroke-linejoin="round"/>
            <path d="M16 11.7c4.4 0 7.6 3.8 7.6 9.2 0 5-2.6 9.4-7.6 16.3-5-6.9-7.6-11.3-7.6-16.3 0-5.4 3.2-9.2 7.6-9.2Z" fill="url(#pinGlow)"/>
            <circle cx="16" cy="21" r="5.2" fill="#ffffff" opacity="0.96"/>
            <circle cx="16" cy="21" r="2.2" fill="#0b0f1a" opacity="0.92"/>
          </svg>
        `,
        iconSize: [32, 42],
        iconAnchor: [16, 40],
        className: "map-pin-icon",
      }),
    []
  );

  const [copiedCoords, setCopiedCoords] = useState(false);

  const copyActiveImageCoords = useCallback(async () => {
    if (!activeImage) return;
    const coords = `${activeImage.lat.toFixed(6)}, ${activeImage.lon.toFixed(6)}`;
    try {
      await navigator.clipboard.writeText(coords);
      setCopiedCoords(true);
      window.setTimeout(() => setCopiedCoords(false), 1400);
    } catch {
      setCopiedCoords(false);
    }
  }, [activeImage]);

  useEffect(() => {
    pointsRef.current = trajectory;
  }, [trajectory]);

  // ---------------------------------------------------------------------------
  // Map init
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      preferCanvas: false,
    }).setView([36.83, 10.15], 11);

    const cursorPane = map.createPane("cursorPane");
    cursorPane.style.zIndex = "950";
    cursorPane.style.pointerEvents = "none";

    L.control.zoom({ position: "bottomright" }).addTo(map);

    tileRef.current = L.tileLayer(TILE_URL.osm, {
      attribution: ATTRIBUTION.osm,
      maxZoom: 20,
    }).addTo(map);

    // Click handler: only for trajectory playback seeking
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (!pointsRef.current.length) return;
      const idx = nearestTrajectoryIndex(
        pointsRef.current,
        e.latlng.lat,
        e.latlng.lng
      );
      setIndex(idx);
    });

    mapRef.current = map;
    setMapReady(true);

    // Notify parent that map is ready
    onMapReady?.(map);

    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [setIndex, onMapReady]);

  // ---------------------------------------------------------------------------
  // Fly to searched location
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!flyToTarget || !map) return;
    map.flyTo([flyToTarget.lat, flyToTarget.lon], flyToTarget.zoom, {
      animate: true,
      duration: 1.4,
    });
    clearFlyTo();
  }, [flyToTarget, clearFlyTo]);

  // ---------------------------------------------------------------------------
  // Basemap swap
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) tileRef.current.remove();
    tileRef.current = L.tileLayer(TILE_URL[basemap], {
      attribution: ATTRIBUTION[basemap],
      maxZoom: 20,
    }).addTo(map);
  }, [basemap]);

  // ---------------------------------------------------------------------------
  // AOI rectangle
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (aoiRectRef.current) {
      aoiRectRef.current.remove();
      aoiRectRef.current = null;
    }

    if (!aoi) return;

    const bounds = L.latLngBounds(
      [aoi.south, aoi.west] as L.LatLngTuple,
      [aoi.north, aoi.east] as L.LatLngTuple
    );

    aoiRectRef.current = L.rectangle(bounds, {
      color: "#22d3ee",
      weight: 1.5,
      dashArray: "6 4",
      fillOpacity: 0.05,
    }).addTo(map);

    map.fitBounds(bounds, { padding: [48, 48] });
  }, [aoi, mode]);

  // ---------------------------------------------------------------------------
  // Risk polygon layers
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (riskLayerGroupRef.current) {
      riskLayerGroupRef.current.clearLayers();
    } else {
      riskLayerGroupRef.current = L.layerGroup().addTo(map);
    }

    const layers = activeLayer === "flood" ? floodLayers : heatLayers;

    for (const layer of layers) {
      const category = (layer.components.category ?? 1) as RiskCategory;
      const color = RISK_COLORS[category];
      if (color === "transparent") continue;
      L.geoJSON(layer.geometry as unknown as GeoJSON.GeoJsonObject, {
        style: { color, fillColor: color, fillOpacity: 0.5, weight: 0 },
      })
        .bindPopup(
          `<b>${activeLayer} risk</b><br>Score: ${layer.score.toFixed(2)}`
        )
        .addTo(riskLayerGroupRef.current!);
    }
  }, [floodLayers, heatLayers, activeLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (assistantRouteLineRef.current) {
      assistantRouteLineRef.current.remove();
      assistantRouteLineRef.current = null;
    }

    if (assistantRoute.length < 2) return;

    assistantRouteLineRef.current = L.polyline(
      assistantRoute.map((point) => [point.lat, point.lon] as L.LatLngTuple),
      {
        color: "#a78bfa",
        weight: 3,
        dashArray: "8 4",
        opacity: 0.9,
      }
    ).addTo(map);
  }, [assistantRoute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const marker of assistantMarkersRef.current) {
      marker.remove();
    }
    assistantMarkersRef.current = [];

    for (const waypoint of assistantWaypoints) {
      const icon = L.divIcon({
        html: `<div style="background:#7c3aed;color:white;padding:2px 6px;border-radius:8px;font-size:11px;white-space:nowrap;border:1px solid rgba(167,139,250,0.4)">${waypoint.label.split(",")[0]}</div>`,
        className: "",
      });

      const marker = L.marker([waypoint.lat, waypoint.lon], {
        icon,
        zIndexOffset: 9000,
      }).addTo(map);

      assistantMarkersRef.current.push(marker);
    }
  }, [assistantWaypoints]);

  // ---------------------------------------------------------------------------
  // Trajectory polyline
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (lineRef.current) {
      lineRef.current.remove();
      lineRef.current = null;
    }

    if (trajectory.length < 2) return;

    const latlngs = trajectory.map((p) => [p.lat, p.lon] as L.LatLngTuple);
    lineRef.current = L.polyline(latlngs, {
      color: "#00f3ff",
      weight: 4,
      opacity: 0.85,
      lineCap: "round",
      lineJoin: "round",
      className: "path-neon-glow",
    }).addTo(map);
  }, [trajectory]);

  // ---------------------------------------------------------------------------
  // Trajectory playback marker
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (mode !== "advanced") {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }

    const activeImage = images[clampIndex(currentIndex, images.length)];
    const fallbackTrajectoryPoint = trajectory[clampIndex(currentIndex, trajectory.length)];

    const markerLat = activeImage?.lat ?? fallbackTrajectoryPoint?.lat;
    const markerLon = activeImage?.lon ?? fallbackTrajectoryPoint?.lon;

    if (markerLat === undefined || markerLon === undefined) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }

    const latlng = [markerLat, markerLon] as L.LatLngTuple;

    if (!markerRef.current) {
      markerRef.current = L.marker(latlng, {
        icon: mapPinIcon,
        zIndexOffset: 9999,
        keyboard: false,
      }).addTo(map);
    } else {
      if (!map.hasLayer(markerRef.current)) {
        markerRef.current.addTo(map);
      }
      markerRef.current.setLatLng(latlng);
      markerRef.current.setIcon(mapPinIcon);
      markerRef.current.setZIndexOffset(9999);
    }

    if (!map.getBounds().contains(latlng)) {
      map.flyTo(latlng, map.getZoom(), { animate: true, duration: 0.8 });
    } else {
      map.panTo(latlng, { animate: true, duration: 0.3 });
    }
  }, [mode, images, trajectory, currentIndex, mapReady, mapPinIcon]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="relative h-full w-full">
      <div ref={mapContainerRef} className="h-full w-full" />

      {/* Basemap switcher */}
      <div className="absolute top-3 right-3 z-[550] flex gap-1 rounded-lg bg-black/70 p-1 text-xs text-white">
        {(["osm", "satellite", "terrain"] as Basemap[]).map((key) => (
          <button
            key={key}
            onClick={() => setBasemap(key)}
            className={`rounded px-2 py-1 capitalize ${
              basemap === key
                ? "bg-cyan-500 text-black"
                : "bg-white/10 hover:bg-white/20"
            }`}
            type="button"
          >
            {key}
          </button>
        ))}
      </div>

      {/* Image location badge (advanced mode) */}
      {mode === "advanced" && activeImage && (
        <button
          type="button"
          onClick={copyActiveImageCoords}
          title="Copy image coordinates"
          className="absolute top-3 left-3 z-[570] rounded-lg border border-cyan-400/30 bg-black/70 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-sm text-left hover:border-cyan-300/60"
        >
          <div className="flex items-center gap-2 text-cyan-300 font-semibold uppercase tracking-wide">
            <span className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)]" />
            Image Location
          </div>
          <div className="mt-1 text-slate-200">
            Lat {activeImage.lat.toFixed(5)} · Lon {activeImage.lon.toFixed(5)}
          </div>
          <div className="mt-1 text-[11px] text-cyan-200/90">
            {copiedCoords ? "Copied" : "Click to copy"}
          </div>
        </button>
      )}
    </div>
  );
}