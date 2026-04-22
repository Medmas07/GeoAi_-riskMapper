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
// Ramer-Douglas-Peucker simplification
// ---------------------------------------------------------------------------
function perpendicularDistance(
  pt: L.LatLng,
  lineStart: L.LatLng,
  lineEnd: L.LatLng
): number {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag === 0) {
    return Math.sqrt(
      (pt.lng - lineStart.lng) ** 2 + (pt.lat - lineStart.lat) ** 2
    );
  }
  const u = ((pt.lng - lineStart.lng) * dx + (pt.lat - lineStart.lat) * dy) / (mag * mag);
  const closestLng = lineStart.lng + u * dx;
  const closestLat = lineStart.lat + u * dy;
  return Math.sqrt((pt.lng - closestLng) ** 2 + (pt.lat - closestLat) ** 2);
}

function rdp(points: L.LatLng[], epsilon: number): L.LatLng[] {
  if (points.length < 3) return points;
  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, maxIdx + 1), epsilon);
    const right = rdp(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}

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

function corridorWeightPx(
  map: L.Map,
  widthMeters: number,
  points: Array<{ lat: number }>
) {
  if (!points.length) return 4;
  const avgLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const metersPerPixel =
    (40075016.686 * Math.cos((avgLat * Math.PI) / 180)) /
    (256 * Math.pow(2, map.getZoom()));
  const px = (2 * widthMeters) / Math.max(metersPerPixel, 0.0001);
  return Math.max(4, Math.min(120, px));
}

// RDP epsilon in degrees — ~11m, tight enough to follow roads
const RDP_EPSILON = 0.0001;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function MapView() {
  const mode = useAnalysisStore((s) => s.mode);
  const trajectory = useAnalysisStore((s) => s.trajectory);
  const images = useAnalysisStore((s) => s.images);
  const drawnPath = useAnalysisStore((s) => s.drawnPath);
  const currentIndex = useAnalysisStore((s) => s.currentIndex);
  const setIndex = useAnalysisStore((s) => s.setIndex);
  const aoi = useAnalysisStore((s) => s.aoi);
  const setAOI = useAnalysisStore((s) => s.setAOI);
  const setDrawnPath = useAnalysisStore((s) => s.setDrawnPath);
  const pathWidthMeters = useAnalysisStore((s) => s.pathWidthMeters);
  const setPathWidthMeters = useAnalysisStore((s) => s.setPathWidthMeters);

  const floodLayers = useAnalysisStore((s) => s.floodLayers);
  const heatLayers = useAnalysisStore((s) => s.heatLayers);
  const activeLayer = useAnalysisStore((s) => s.activeLayer);

  // ─── ADDED: Fly to target from store ─────────────────────────────────────
  const flyToTarget = useAnalysisStore((s) => s.flyToTarget);
  const clearFlyTo = useAnalysisStore((s) => s.clearFlyTo);

  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const aoiRectRef = useRef<L.Rectangle | null>(null);
  const riskLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  // Freehand drawing refs
  const isDrawingRef = useRef(false);
  const rawPathRef = useRef<L.LatLng[]>([]);
  const redoStackRef = useRef<L.LatLng[]>([]);
  const cursorPointRef = useRef<L.Point | null>(null);
  const autoPanRafRef = useRef<number | null>(null);
  const drawPolylineRef = useRef<L.Polyline | null>(null);
  const pathCorridorRef = useRef<L.Polyline | null>(null);
  const snappedPreviewLineRef = useRef<L.Polyline | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewRequestSeqRef = useRef(0);
  const lastPreviewAtRef = useRef(0);
  const simplifiedPolylineRef = useRef<L.Polyline | null>(null);
  const pointsRef = useRef<TrajectoryPoint[]>([]);

  const [basemap, setBasemap] = useState<Basemap>("osm");
  const [drawMode, setDrawMode] = useState(false);
  const [, setDrawRevision] = useState(0);
  const [copiedCoords, setCopiedCoords] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const drawModeRef = useRef(false);
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
    drawModeRef.current = drawMode;
  }, [drawMode]);

  useEffect(() => {
    pointsRef.current = trajectory;
  }, [trajectory]);

  const stopAutoPanLoop = useCallback(() => {
    if (autoPanRafRef.current !== null) {
      window.cancelAnimationFrame(autoPanRafRef.current);
      autoPanRafRef.current = null;
    }
  }, []);

  const clearSnappedPreview = useCallback(() => {
    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
      previewAbortRef.current = null;
    }
    if (snappedPreviewLineRef.current) {
      snappedPreviewLineRef.current.remove();
      snappedPreviewLineRef.current = null;
    }
  }, []);

  const updateSnappedPreview = useCallback(
    async (from: L.LatLng, to: L.LatLng) => {
      const map = mapRef.current;
      if (!map || !drawModeRef.current) return;

      const now = Date.now();
      if (now - lastPreviewAtRef.current < 220) return;
      lastPreviewAtRef.current = now;

      if (map.distance(from, to) < 8) {
        clearSnappedPreview();
        return;
      }

      if (previewAbortRef.current) {
        previewAbortRef.current.abort();
      }

      const controller = new AbortController();
      previewAbortRef.current = controller;
      const requestSeq = ++previewRequestSeqRef.current;

      const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
      const url =
        `https://router.project-osrm.org/route/v1/driving/${coords}` +
        "?overview=full&geometries=geojson&steps=false&continue_straight=true";

      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        if (requestSeq !== previewRequestSeqRef.current) return;
        if (data?.code !== "Ok") return;

        const routeCoords = data?.routes?.[0]?.geometry?.coordinates as
          | [number, number][]
          | undefined;
        if (!routeCoords || routeCoords.length < 2) return;

        const latlngs = routeCoords.map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
        if (snappedPreviewLineRef.current) {
          snappedPreviewLineRef.current.setLatLngs(latlngs);
        } else {
          snappedPreviewLineRef.current = L.polyline(latlngs, {
            color: "#22d3ee",
            weight: 2,
            opacity: 0.55,
            dashArray: "2 6",
          }).addTo(map);
        }
      } catch {
        // ignore aborted preview requests
      }
    },
    [clearSnappedPreview]
  );

  const startAutoPanLoop = useCallback(() => {
    if (autoPanRafRef.current !== null) return;

    const EDGE_MARGIN = 72;
    const MAX_STEP = 14;

    const tick = () => {
      const map = mapRef.current;
      const pointer = cursorPointRef.current;

      if (map && drawModeRef.current && pointer && rawPathRef.current.length > 0) {
        const size = map.getSize();
        let dx = 0;
        let dy = 0;

        if (pointer.x < EDGE_MARGIN) {
          dx = -Math.min(MAX_STEP, (EDGE_MARGIN - pointer.x) / 3 + 2);
        } else if (size.x - pointer.x < EDGE_MARGIN) {
          dx = Math.min(MAX_STEP, (EDGE_MARGIN - (size.x - pointer.x)) / 3 + 2);
        }

        if (pointer.y < EDGE_MARGIN) {
          dy = -Math.min(MAX_STEP, (EDGE_MARGIN - pointer.y) / 3 + 2);
        } else if (size.y - pointer.y < EDGE_MARGIN) {
          dy = Math.min(MAX_STEP, (EDGE_MARGIN - (size.y - pointer.y)) / 3 + 2);
        }

        if (dx !== 0 || dy !== 0) {
          map.panBy([dx, dy], { animate: false });
        }
      }

      autoPanRafRef.current = window.requestAnimationFrame(tick);
    };

    autoPanRafRef.current = window.requestAnimationFrame(tick);
  }, []);

  const applyPathState = useCallback(
    (path: L.LatLng[]) => {
      const map = mapRef.current;

      if (drawPolylineRef.current) {
        if (path.length > 0) {
          drawPolylineRef.current.setLatLngs(path);
        } else {
          drawPolylineRef.current.remove();
          drawPolylineRef.current = null;
        }
      } else if (path.length > 0 && map) {
        drawPolylineRef.current = L.polyline(path, {
          color: "#00f3ff",
          weight: 3,
          opacity: 0.8,
          dashArray: "8 6",
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map);
      }

      if (path.length >= 2 && map) {
        if (simplifiedPolylineRef.current) {
          simplifiedPolylineRef.current.setLatLngs(path);
        } else {
          simplifiedPolylineRef.current = L.polyline(path, {
            color: "#00f3ff",
            weight: 4,
            opacity: 1.0,
            lineCap: "round",
            lineJoin: "round",
            className: "path-glow-animation",
          }).addTo(map);
        }

        const lats = path.map((p) => p.lat);
        const lngs = path.map((p) => p.lng);
        setAOI({
          south: Math.min(...lats),
          north: Math.max(...lats),
          west: Math.min(...lngs),
          east: Math.max(...lngs),
        });
        setDrawnPath(path.map((p) => ({ lat: p.lat, lon: p.lng })));
      } else {
        if (simplifiedPolylineRef.current) {
          simplifiedPolylineRef.current.remove();
          simplifiedPolylineRef.current = null;
        }
        setAOI(null);
        setDrawnPath(null);
      }

      setDrawRevision((v) => v + 1);
    },
    [setAOI, setDrawnPath]
  );

  const undoLastPoint = useCallback(() => {
    if (rawPathRef.current.length === 0) return;
    const removed = rawPathRef.current.pop();
    if (removed) {
      redoStackRef.current.push(removed);
    }
    applyPathState(rawPathRef.current);
  }, [applyPathState]);

  const redoLastPoint = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const restored = redoStackRef.current.pop();
    if (!restored) return;
    rawPathRef.current.push(restored);
    applyPathState(rawPathRef.current);
  }, [applyPathState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!drawMode) return;
      const key = e.key.toLowerCase();
      const hasModifier = e.ctrlKey || e.metaKey;

      if (key === "enter") {
        e.preventDefault();
        const map = mapRef.current;
        if (map) {
          map.doubleClickZoom.enable();
          map.getContainer().style.cursor = "";
        }
        stopAutoPanLoop();
        clearSnappedPreview();
        cursorPointRef.current = null;
        setDrawMode(false);
        return;
      }

      if (key === "escape") {
        e.preventDefault();
        rawPathRef.current = [];
        redoStackRef.current = [];
        applyPathState([]);
        const map = mapRef.current;
        if (map) {
          map.doubleClickZoom.enable();
          map.getContainer().style.cursor = "";
        }
        stopAutoPanLoop();
        clearSnappedPreview();
        cursorPointRef.current = null;
        setDrawMode(false);
        return;
      }

      if (hasModifier && key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoLastPoint();
        return;
      }

      if (hasModifier && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        redoLastPoint();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawMode, undoLastPoint, redoLastPoint, applyPathState, stopAutoPanLoop, clearSnappedPreview]);

  const toggleDrawMode = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setDrawMode((prev) => {
      const next = !prev;
      if (next) {
        rawPathRef.current = [];
        redoStackRef.current = [];
        if (drawPolylineRef.current) {
          drawPolylineRef.current.remove();
          drawPolylineRef.current = null;
        }
        if (simplifiedPolylineRef.current) {
          simplifiedPolylineRef.current.remove();
          simplifiedPolylineRef.current = null;
        }
        map.doubleClickZoom.disable();
        map.getContainer().style.cursor = "crosshair";
        setDrawRevision((v) => v + 1);
      } else {
        map.doubleClickZoom.enable();
        map.getContainer().style.cursor = "";
        stopAutoPanLoop();
        clearSnappedPreview();
        cursorPointRef.current = null;
      }
      return next;
    });
  }, [stopAutoPanLoop, clearSnappedPreview]);

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

    map.on("click", (e: L.LeafletMouseEvent) => {
      if (drawModeRef.current) {
        rawPathRef.current.push(e.latlng);
        redoStackRef.current = [];
        applyPathState(rawPathRef.current);
      } else {
        if (!pointsRef.current.length) return;
        const idx = nearestTrajectoryIndex(
          pointsRef.current,
          e.latlng.lat,
          e.latlng.lng
        );
        setIndex(idx);
      }
    });

    let cursorLine: L.Polyline | null = null;
    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      cursorPointRef.current = e.containerPoint;

      if (!drawModeRef.current || rawPathRef.current.length === 0) {
        stopAutoPanLoop();
        clearSnappedPreview();
        if (cursorLine) {
          cursorLine.remove();
          cursorLine = null;
        }
        return;
      }

      startAutoPanLoop();

      const lastPoint = rawPathRef.current[rawPathRef.current.length - 1];
      void updateSnappedPreview(lastPoint, e.latlng);
      if (!cursorLine) {
        cursorLine = L.polyline([lastPoint, e.latlng], {
          color: "#38bdf8",
          weight: 2.5,
          opacity: 0.4,
          dashArray: "5 4",
        }).addTo(map);
      } else {
        cursorLine.setLatLngs([lastPoint, e.latlng]);
      }
    });

    map.on("contextmenu", () => {
      if (drawModeRef.current) {
        clearSnappedPreview();
        if (cursorLine) {
          cursorLine.remove();
          cursorLine = null;
        }
      }
    });

    mapRef.current = map;
    setMapReady(true);

    return () => {
      stopAutoPanLoop();
      clearSnappedPreview();
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [setAOI, setDrawnPath, setIndex, applyPathState, startAutoPanLoop, stopAutoPanLoop, clearSnappedPreview, updateSnappedPreview]);

  // ---------------------------------------------------------------------------
  // Fly to searched location (FIXED - no infinite loop)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!flyToTarget || !map) return;
    map.flyTo([flyToTarget.lat, flyToTarget.lon], flyToTarget.zoom, {
      animate: true,
      duration: 1.4,
    });
    clearFlyTo(); // ← clears target so effect doesn't loop
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

    if (!drawMode) {
      map.fitBounds(bounds, { padding: [48, 48] });
    }
  }, [aoi, mode, drawMode]);

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

    if (drawnPath && drawnPath.length >= 2) {
      const latlngs = drawnPath.map((point) => [point.lat, point.lon] as L.LatLngTuple);
      lineRef.current = L.polyline(latlngs, {
        color: "#ffffff",
        weight: 4,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
        className: "path-neon-glow",
      }).addTo(map);
      lineRef.current.bringToFront();
      return;
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
  }, [trajectory, drawnPath]);

  // ---------------------------------------------------------------------------
  // Path corridor visualization
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (pathCorridorRef.current) {
      pathCorridorRef.current.remove();
      pathCorridorRef.current = null;
    }

    if (!drawnPath || drawnPath.length < 2) return;

    const latlngs = drawnPath.map((point) => [point.lat, point.lon] as L.LatLngTuple);

    const updateWidth = () => {
      if (!pathCorridorRef.current) return;
      pathCorridorRef.current.setStyle({
        weight: corridorWeightPx(map, pathWidthMeters, drawnPath),
      });
    };

    pathCorridorRef.current = L.polyline(latlngs, {
      color: "#00f3ff",
      opacity: 0.25,
      className: "corridor-pulse",
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
      weight: corridorWeightPx(map, pathWidthMeters, drawnPath),
    }).addTo(map);

    pathCorridorRef.current.bringToBack();
    lineRef.current?.bringToFront();

    map.on("zoomend", updateWidth);
    return () => {
      map.off("zoomend", updateWidth);
      if (pathCorridorRef.current) {
        pathCorridorRef.current.remove();
        pathCorridorRef.current = null;
      }
    };
  }, [drawnPath, pathWidthMeters]);

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

      {/* Pen / draw mode toggle */}
      <div className="absolute top-16 right-3 z-[560] flex items-center gap-2">
        <button
          type="button"
          onClick={toggleDrawMode}
          title={drawMode ? "Finish drawing" : "Draw path point by point"}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold shadow-lg transition-all ${
            drawMode
              ? "bg-cyan-400 text-black ring-2 ring-cyan-300"
              : "bg-black/70 text-white hover:bg-black/85"
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5"
          >
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
          </svg>
          {drawMode ? "Drawing..." : "Draw Path"}
        </button>

        {drawMode && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                undoLastPoint();
              }}
              disabled={rawPathRef.current.length === 0}
              title="Undo last point (Ctrl+Z)"
              className="flex items-center gap-1.5 rounded-lg bg-black/70 px-3 py-2 text-xs font-semibold text-white shadow-lg transition-all hover:bg-black/85 hover:text-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Undo
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                redoLastPoint();
              }}
              disabled={redoStackRef.current.length === 0}
              title="Redo last point (Ctrl+Y or Ctrl+Shift+Z)"
              className="flex items-center gap-1.5 rounded-lg bg-black/70 px-3 py-2 text-xs font-semibold text-white shadow-lg transition-all hover:bg-black/85 hover:text-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path fillRule="evenodd" d="M12.293 3.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 11-1.414-1.414L14.586 9H9a5 5 0 00-5 5v2a1 1 0 11-2 0v-2a7 7 0 017-7h5.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              Redo            </button>
          </>
        )}
      </div>

      {/* Path width control (simple mode only) */}
      {mode === "simple" && (
        <div className="absolute top-28 right-3 z-[560] w-48 rounded-lg bg-black/70 p-2 text-xs text-white shadow-lg">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold">Line Width</span>
            <span>{pathWidthMeters} m</span>
          </div>
          <input
            type="range"
            min={5}
            max={120}
            step={5}
            value={pathWidthMeters}
            onChange={(e) => setPathWidthMeters(Number(e.target.value))}
            className="w-full accent-cyan-400"
          />
        </div>
      )}

      {/* Status hint (simple mode only) */}
      {mode === "simple" && (
        <div className="absolute bottom-3 left-3 z-[550] rounded-md bg-black/65 px-3 py-2 text-xs text-white">
          {drawMode
            ? "Click to add points, drag map to continue, Ctrl+Z undo, Ctrl+Y redo, Enter to finish, Esc to cancel."
            : 'Click "Draw Path" to start tracing a road point by point.'}
        </div>
      )}
    </div>
  );
}