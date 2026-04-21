"use client";
import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAnalysisStore } from "@/store/analysis";
import { RISK_COLORS, type RiskLayer, type RiskCategory } from "@/types";

export default function RiskMap() {
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const { bbox, setBbox, result, activeLayer, images } = useAnalysisStore();

  // Initialize map
  useEffect(() => {
    if (mapRef.current) return;

    const map = L.map("map").setView([36.0, 2.0], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    layerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // BBox selection via drag
    let drawing = false;
    let startLatLng: L.LatLng | null = null;
    let rect: L.Rectangle | null = null;

    map.on("mousedown", (e: L.LeafletMouseEvent) => {
      if (!e.originalEvent.shiftKey) return;
      drawing = true;
      startLatLng = e.latlng;
    });

    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      if (!drawing || !startLatLng) return;
      if (rect) rect.remove();
      const bounds = L.latLngBounds(startLatLng, e.latlng);
      rect = L.rectangle(bounds, {
        color: "#2563eb",
        weight: 2,
        fillOpacity: 0.1,
      }).addTo(map);
    });

    map.on("mouseup", (e: L.LeafletMouseEvent) => {
      if (!drawing || !startLatLng) return;
      drawing = false;
      const bounds = L.latLngBounds(startLatLng, e.latlng);
      setBbox({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [setBbox]);

  // Render risk layers
  useEffect(() => {
    const lg = layerGroupRef.current;
    if (!lg || !result) return;
    lg.clearLayers();

    const layers: RiskLayer[] =
      activeLayer === "flood" ? result.flood_layers : result.heat_layers;

    layers.forEach((layer) => {
      const cat = (layer.components.category ?? 0) as RiskCategory;
      const color = RISK_COLORS[cat] ?? "#888";

      const coords = layer.geometry.coordinates[0] as [number, number][];
      const latLngs = coords.map(([lng, lat]) => [lat, lng] as L.LatLngTuple);

      L.polygon(latLngs, {
        color,
        fillColor: color,
        fillOpacity: 0.55,
        weight: 0,
      })
        .bindTooltip(`Score: ${(layer.score * 100).toFixed(0)}%`)
        .addTo(lg);
    });

    // Image markers
    if (activeLayer === "images") {
      images.forEach((img) => {
        L.circleMarker([img.lat, img.lon], {
          radius: 5,
          color: "#7c3aed",
          fillColor: "#7c3aed",
          fillOpacity: 0.8,
        })
          .bindPopup(`<img src="${img.thumb_url}" width="200" />`)
          .addTo(lg);
      });
    }
  }, [result, activeLayer, images]);

  return <div id="map" className="h-full w-full" />;
}
