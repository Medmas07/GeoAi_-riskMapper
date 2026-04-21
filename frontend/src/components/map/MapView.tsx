"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAnalysisStore, type TrajectoryPoint } from "@/store/analysis";

type Basemap = "osm" | "satellite" | "terrain";

const TILE_URL: Record<Basemap, string> = {
  osm: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  terrain: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
};

const ATTRIBUTION: Record<Basemap, string> = {
  osm: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  satellite:
    "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  terrain: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> contributors',
};

function nearestTrajectoryIndex(points: TrajectoryPoint[], lat: number, lon: number) {
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

export default function MapView() {
  const mode = useAnalysisStore((s) => s.mode);
  const trajectory = useAnalysisStore((s) => s.trajectory);
  const currentIndex = useAnalysisStore((s) => s.currentIndex);
  const setIndex = useAnalysisStore((s) => s.setIndex);
  const aoi = useAnalysisStore((s) => s.aoi);
  const setAOI = useAnalysisStore((s) => s.setAOI);

  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const aoiRectRef = useRef<L.Rectangle | null>(null);
  const previewRectRef = useRef<L.Rectangle | null>(null);
  const drawStartRef = useRef<L.LatLng | null>(null);
  const isDrawingRef = useRef(false);
  const pointsRef = useRef<TrajectoryPoint[]>([]);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  const [basemap, setBasemap] = useState<Basemap>("osm");

  useEffect(() => {
    pointsRef.current = trajectory;
  }, [trajectory]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      preferCanvas: true,
    }).setView([36.75, 3.06], 6);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    tileRef.current = L.tileLayer(TILE_URL.osm, {
      attribution: ATTRIBUTION.osm,
      maxZoom: 20,
    }).addTo(map);

    map.on("mousedown", (e: L.LeafletMouseEvent) => {
      if (!e.originalEvent.shiftKey) return;
      isDrawingRef.current = true;
      drawStartRef.current = e.latlng;
      if (previewRectRef.current) previewRectRef.current.remove();
      previewRectRef.current = L.rectangle(L.latLngBounds(e.latlng, e.latlng), {
        color: "#38bdf8",
        weight: 1,
        dashArray: "4 4",
        fillOpacity: 0.15,
      }).addTo(map);
    });

    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      if (!isDrawingRef.current || !drawStartRef.current || !previewRectRef.current) return;
      previewRectRef.current.setBounds(L.latLngBounds(drawStartRef.current, e.latlng));
    });

    map.on("mouseup", (e: L.LeafletMouseEvent) => {
      if (!isDrawingRef.current || !drawStartRef.current) return;
      isDrawingRef.current = false;
      const bounds = L.latLngBounds(drawStartRef.current, e.latlng);
      if (previewRectRef.current) {
        previewRectRef.current.remove();
        previewRectRef.current = null;
      }
      setAOI({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      });
    });

    map.on("click", (e: L.LeafletMouseEvent) => {
      if (e.originalEvent.shiftKey) return;
      if (!pointsRef.current.length) return;
      const idx = nearestTrajectoryIndex(pointsRef.current, e.latlng.lat, e.latlng.lng);
      setIndex(idx);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [setAOI, setIndex]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileRef.current) tileRef.current.remove();
    tileRef.current = L.tileLayer(TILE_URL[basemap], {
      attribution: ATTRIBUTION[basemap],
      maxZoom: 20,
    }).addTo(map);
  }, [basemap]);

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
      weight: 2,
      fillOpacity: 0.06,
    }).addTo(map);

    if (mode === "simple") {
      map.fitBounds(bounds, { padding: [32, 32] });
    }
  }, [aoi, mode]);

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
      color: "#22c55e",
      weight: 3,
      opacity: 0.85,
    }).addTo(map);
  }, [trajectory]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const point = trajectory[currentIndex];
    if (!point) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }

    const latlng = [point.lat, point.lon] as L.LatLngTuple;
    if (!markerRef.current) {
      markerRef.current = L.circleMarker(latlng, {
        radius: 7,
        color: "#f59e0b",
        fillColor: "#f59e0b",
        fillOpacity: 1,
        weight: 2,
      }).addTo(map);
    } else {
      markerRef.current.setLatLng(latlng);
    }

    map.panTo(latlng, { animate: true, duration: 0.5 });
  }, [trajectory, currentIndex]);

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainerRef} className="h-full w-full" />

      <div className="absolute top-3 right-3 z-[550] flex gap-1 rounded-lg bg-black/70 p-1 text-xs text-white">
        {(["osm", "satellite", "terrain"] as Basemap[]).map((key) => (
          <button
            key={key}
            onClick={() => setBasemap(key)}
            className={`rounded px-2 py-1 capitalize ${
              basemap === key ? "bg-cyan-500 text-black" : "bg-white/10 hover:bg-white/20"
            }`}
            type="button"
          >
            {key}
          </button>
        ))}
      </div>

      {mode === "simple" && (
        <div className="absolute bottom-3 left-3 z-[550] rounded-md bg-black/65 px-3 py-2 text-xs text-white">
          Hold Shift + drag to draw AOI
        </div>
      )}
    </div>
  );
}
