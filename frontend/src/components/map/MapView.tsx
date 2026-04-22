"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAnalysisStore, type TrajectoryPoint } from "@/store/analysis";
import { RISK_COLORS, type RiskCategory } from "@/types";

type Basemap = "osm" | "satellite" | "terrain";

const TILE_URL: Record<Basemap, string> = {
  osm: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  satellite:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  terrain: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
};

const ATTRIBUTION: Record<Basemap, string> = {
  osm: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  satellite:
    "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  terrain: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> contributors',
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
  const aoiRectRef = useRef<L.Rectangle | null>(null);
  const riskLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  const pointsRef = useRef<TrajectoryPoint[]>([]);

  const [basemap, setBasemap] = useState<Basemap>("osm");
  const [mapReady, setMapReady] = useState(false);

  const activeImage = images[clampIndex(currentIndex, images.length)];
  const googlePinIcon = useMemo(
    () =>
      L.divIcon({
        html: '<span class="google-pin-emoji" aria-hidden="true">📍</span>',
        iconSize: [28, 42],
        iconAnchor: [14, 42],
        className: "google-pin-icon",
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

    if (mode !== "advanced") {
      map.fitBounds(bounds, { padding: [48, 48] });
    }
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
        icon: googlePinIcon,
        zIndexOffset: 9999,
        keyboard: false,
      }).addTo(map);
    } else {
      if (!map.hasLayer(markerRef.current)) {
        markerRef.current.addTo(map);
      }
      markerRef.current.setLatLng(latlng);
      markerRef.current.setIcon(googlePinIcon);
      markerRef.current.setZIndexOffset(9999);
    }

    if (!map.getBounds().contains(latlng)) {
      map.flyTo(latlng, map.getZoom(), { animate: true, duration: 0.8 });
    } else {
      map.panTo(latlng, { animate: true, duration: 0.3 });
    }
  }, [mode, images, trajectory, currentIndex, mapReady, googlePinIcon]);

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