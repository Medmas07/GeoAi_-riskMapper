"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AssistantChatMessage } from "@/lib/api";
import { useAnalysisStore, type DrawnPathPoint } from "@/store/analysis";

const GROQ_MODEL = process.env.NEXT_PUBLIC_GROQ_MODEL?.trim() || undefined;

type Role = "user" | "assistant" | "tool";

interface Message {
  id: string;
  role: Role;
  content: string;
  toolCallId?: string;
  toolName?: string;
  isStreaming?: boolean;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface GeocodeResult {
  lat: number;
  lon: number;
  display_name: string;
  boundingbox?: [string, string, string, string];
}

interface ReverseGeocodeResult {
  display_name?: string;
  name?: string;
  address?: {
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "geocode_location",
      description: "Convert a place name or address into coordinates and center the map there.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "A place name or address such as 'Tunis, Tunisia'",
          },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_waypoints",
      description:
        "Place two or more named waypoints on the map, compute an OSRM driving route, and update the path overlay.",
      parameters: {
        type: "object",
        properties: {
          waypoints: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            description: "Ordered list of place names to route through",
          },
        },
        required: ["waypoints"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Fetch current and recent weather for a location.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "Place name, e.g. 'Sfax, Tunisia'" },
          days_back: {
            type: "number",
            description: "How many days of history to include",
            default: 7,
          },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_risk_summary",
      description: "Read the risk analysis results currently loaded in the app and summarize them.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_risk_analysis",
      description:
        "Run a new flood and heat risk analysis for a named location and center the map on the resulting area.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "Location name, e.g. 'Nabeul, Tunisia'",
          },
          radius_km: {
            type: "number",
            description: "Radius around the location in kilometers",
            default: 2,
          },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_map_overlays",
      description: "Remove assistant-generated waypoints, route overlays, and drawn path state.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
] as const;

function genId() {
  return Math.random().toString(36).slice(2, 9);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// Clean up Nominatim display names — remove Arabic text and long admin chains
function cleanLocationName(raw: string): string {
  // Split by comma, take first and last parts only
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 2) return raw;
  return `${parts[0]}, ${parts[parts.length - 1]}`;
}

// Check if a location string is vague (user meant "here" / "the analyzed area")
const VAGUE_TERMS = ["here", "there", "this area", "current area", "analyzed area",
  "this location", "the area", "nearby", "current location", "this place"];

function isVagueLocation(loc: string): boolean {
  const lower = loc.toLowerCase().trim();
  return !lower || VAGUE_TERMS.some((t) => lower.includes(t));
}

function isWeatherQuestion(text: string): boolean {
  return /\b(weather|forecast|temperature|temp|rain|rainfall|raining|sunny|wind|humidity)\b/i.test(text);
}

function isPlaceIdentityQuestion(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return /\b(what s this place|what is this place|what s the place|what is the place|what place is this|where am i|where is this|where is this place|identify this place|name this place|which place is this)\b/i.test(
    normalized
  );
}

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=jsonv2`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) return null;
  const data = (await res.json()) as ReverseGeocodeResult;
  const parts = [
    data.address?.suburb,
    data.address?.neighbourhood,
    data.address?.city,
    data.address?.town,
    data.address?.village,
    data.address?.county,
    data.address?.state,
    data.address?.country,
  ].filter(Boolean) as string[];
  return data.display_name ?? data.name ?? (parts.length ? parts.join(", ") : null);
}

async function geocode(location: string): Promise<GeocodeResult | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=jsonv2&limit=1`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) return null;
  const data = (await res.json()) as GeocodeResult[];
  if (!data.length) return null;
  return {
    lat: Number(data[0].lat),
    lon: Number(data[0].lon),
    display_name: data[0].display_name,
    boundingbox: data[0].boundingbox,
  };
}

async function getOSRMRoute(coords: { lat: number; lon: number }[]) {
  const coordStr = coords.map((c) => `${c.lon},${c.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("OSRM routing failed");
  const data = await res.json();
  if (data.code !== "Ok") throw new Error("OSRM returned a non-Ok response");
  return data.routes[0] as {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
  };
}

function buildSystemPrompt() {
  const state = useAnalysisStore.getState();
  const hasRisk = state.floodLayers.length > 0 || state.heatLayers.length > 0;
  const aoiCenter = state.aoi
    ? {
        lat: ((state.aoi.north + state.aoi.south) / 2).toFixed(4),
        lon: ((state.aoi.east + state.aoi.west) / 2).toFixed(4),
      }
    : null;

  return `You are GeoAI, a geospatial assistant for flood/heat risk mapping.

TOOL RULES (never violate):
- run_risk_analysis: ONLY if user names a specific place. Never invent locations.
- set_waypoints: ONLY if user gives 2+ place names. Never invent destinations.
- Knowledge questions (why/how/what causes): answer directly, no tools.
- get_risk_summary: when user asks about current map results.
- geocode_location: when user asks to navigate/find a place.
- get_weather: when user asks about weather. If user says "here", "there", "this area" — still call get_weather, the tool will use the current map area automatically.
- The current map area from the zustand store is authoritative. If it exists and the user asks about weather "here/there/current area", use that area and do not invent a city name.

APP STATE:
- Risk loaded: ${hasRisk ? `YES (${state.floodLayers.length} flood, ${state.heatLayers.length} heat zones)` : "NO"}
- Current map area: ${aoiCenter ? `lat ${aoiCenter.lat}, lon ${aoiCenter.lon}` : "none set"}
- Active layer: ${state.activeLayer} | Running: ${state.isRunning ? "YES — wait" : "no"}

Scores: 0-0.2=none, 0.2-0.4=low, 0.4-0.6=medium, 0.6-0.8=high, 0.8-1.0=extreme.
Be concise. Use bullet points. Max 100 words per response.`;
}

// Contextual suggestions based on current store state
function getContextualSuggestions(): string[] {
  const state = useAnalysisStore.getState();
  const hasRisk = state.floodLayers.length > 0 || state.heatLayers.length > 0;
  const hasAoi = !!state.aoi;

  const suggestions: string[] = [];

  if (hasRisk) {
    suggestions.push("Explain the risk results");
    suggestions.push("What's the weather in this area?");
  } else if (hasAoi) {
    suggestions.push("Run a risk analysis here");
    suggestions.push("What's the weather in this area?");
  } else {
    suggestions.push("Analyze flood risk in Nabeul");
    suggestions.push("Show me Tunis on the map");
  }

  suggestions.push("Route from Tunis to Sousse");

  return suggestions.slice(0, 3);
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  actions: {
    flyTo: (target: { lat: number; lon: number; zoom: number }) => void;
    setAOI: (aoi: { west: number; south: number; east: number; north: number } | null) => void;
    setRunning: (running: boolean) => void;
    setRiskResults: (flood: unknown[], heat: unknown[]) => void;
    setAssistantWaypoints: (waypoints: { lat: number; lon: number; label: string }[]) => void;
    setAssistantRoute: (route: DrawnPathPoint[]) => void;
    clearAssistantRoute: () => void;
    setMode: (mode: "simple" | "advanced") => void;
    setData: (payload: {
      trajectory: { lat: number; lon: number; elevation: number; image_id: string }[];
      images: { id: string; url: string; lat: number; lon: number }[];
      profile: { distance: number; elevation: number; slope: number }[];
    }) => void;
    setLastAnalysisDurationSeconds: (seconds: number | null) => void;
    setDrawnPath: (path: DrawnPathPoint[] | null) => void;
  }
): Promise<string> {
  // Read store once at the top — all tools can use this
  const state = useAnalysisStore.getState();
  const aoiCenter = state.aoi
    ? {
        lat: (state.aoi.north + state.aoi.south) / 2,
        lon: (state.aoi.east + state.aoi.west) / 2,
      }
    : null;

  switch (name) {
    case "geocode_location": {
      const location = String(args.location ?? "");

      // If vague and we have an AOI, use map center
      if (isVagueLocation(location) && aoiCenter) {
        actions.flyTo({ lat: aoiCenter.lat, lon: aoiCenter.lon, zoom: 13 });
        return JSON.stringify({
          action: "map_centered",
          location: "current map area",
          lat: aoiCenter.lat,
          lon: aoiCenter.lon,
        });
      }

      const geo = await geocode(location);
      if (!geo) return `Could not find "${location}".`;

      const [south, north, west, east] = geo.boundingbox ?? [null, null, null, null];
      if (south && north && west && east) {
        actions.setAOI({
          south: Number(south),
          north: Number(north),
          west: Number(west),
          east: Number(east),
        });
      }

      actions.flyTo({ lat: geo.lat, lon: geo.lon, zoom: 13 });
      return JSON.stringify({
        action: "map_centered",
        location: cleanLocationName(geo.display_name),
        lat: geo.lat,
        lon: geo.lon,
      });
    }

    case "set_waypoints": {
      const places = Array.isArray(args.waypoints) ? args.waypoints.map(String) : [];
      if (places.length < 2) return "At least two places are required.";

      const resolved: { lat: number; lon: number; label: string }[] = [];
      for (const place of places) {
        const geo = await geocode(place);
        if (!geo) return `Could not geocode waypoint: ${place}`;
        resolved.push({ lat: geo.lat, lon: geo.lon, label: place });
      }

      const route = await getOSRMRoute(resolved);
      const routePath: DrawnPathPoint[] = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));

      let minLat = routePath[0]?.lat ?? resolved[0].lat;
      let maxLat = minLat;
      let minLon = routePath[0]?.lon ?? resolved[0].lon;
      let maxLon = minLon;

      for (const point of [...routePath, ...resolved]) {
        minLat = Math.min(minLat, point.lat);
        maxLat = Math.max(maxLat, point.lat);
        minLon = Math.min(minLon, point.lon);
        maxLon = Math.max(maxLon, point.lon);
      }

      actions.setAssistantWaypoints(resolved);
      actions.setAssistantRoute(routePath);
      actions.setDrawnPath(routePath);
      actions.setAOI({ west: minLon, south: minLat, east: maxLon, north: maxLat });
      actions.flyTo({
        lat: resolved[Math.floor(resolved.length / 2)].lat,
        lon: resolved[Math.floor(resolved.length / 2)].lon,
        zoom: 11,
      });

      return JSON.stringify({
        action: "route_plotted",
        waypoints: resolved,
        route_distance_km: Number((route.distance / 1000).toFixed(1)),
        route_duration_min: Math.round(route.duration / 60),
      });
    }

    case "get_weather": {
      const location = String(args.location ?? "");
      const daysBack = clamp(Number(args.days_back ?? 7), 1, 90);

      // If vague location ("here", "there", etc.) and AOI exists → use map center directly
      if (isVagueLocation(location) && aoiCenter) {
        const weather = await api.weather.get(aoiCenter.lat, aoiCenter.lon, daysBack);
        return JSON.stringify({
          location: "current map area",
          lat: aoiCenter.lat,
          lon: aoiCenter.lon,
          weather,
        });
      }

      // Otherwise geocode the named location
      const geo = await geocode(location);
      if (!geo) return `Could not find "${location}". Please name a specific place.`;
      const weather = await api.weather.get(geo.lat, geo.lon, daysBack);
      return JSON.stringify({
        location: cleanLocationName(geo.display_name),
        lat: geo.lat,
        lon: geo.lon,
        weather,
      });
    }

    case "get_risk_summary": {
      if (!state.floodLayers.length && !state.heatLayers.length) {
        return JSON.stringify({
          error: "No risk analysis results loaded yet.",
          hint: aoiCenter
            ? "An area is set on the map but no analysis has been run. Use run_risk_analysis with a location name."
            : "No area selected. Ask the user which location to analyze.",
        });
      }

      const summarizeLayers = (layers: typeof state.floodLayers) => {
        if (!layers.length) return null;
        const scores = layers.map((l) => l.score);
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const max = Math.max(...scores);
        const dist = { none: 0, low: 0, medium: 0, high: 0, extreme: 0 };
        for (const l of layers) {
          const cat = Number((l.components as Record<string, unknown>).category ?? 1);
          if (cat === 0) dist.none++;
          else if (cat === 1) dist.low++;
          else if (cat === 2) dist.medium++;
          else if (cat === 3) dist.high++;
          else dist.extreme++;
        }

        const highRiskLayer = layers.find((l) => l.score > 0.6) ?? layers[0];
        const c = highRiskLayer.components as Record<string, unknown>;

        return {
          total_zones: layers.length,
          avg_score: Number(avg.toFixed(3)),
          max_score: Number(max.toFixed(3)),
          distribution: dist,
          dominant_factors: {
            weather_score: c.weather_score ?? c.heat_stress_score ?? null,
            terrain_score: c.mean_terrain_score ?? null,
            impervious_surface_pct: c.vision_impervious ?? c.uhi_proxy ?? null,
            vegetation_coverage: c.vegetation_coverage ?? null,
            simulation_engine: c.engine ?? null,
            mean_temp_c: c.mean_temp_c ?? null,
          },
        };
      };

      return JSON.stringify({
        aoi: state.aoi,
        active_layer: state.activeLayer,
        analysis_duration_seconds: state.lastAnalysisDurationSeconds,
        flood: summarizeLayers(state.floodLayers),
        heat: summarizeLayers(state.heatLayers),
        interpretation_guide: {
          score_ranges: "0-0.2=none, 0.2-0.4=low, 0.4-0.6=medium, 0.6-0.8=high, 0.8-1.0=extreme",
          weather_score: "0-1, from 7-day rainfall totals",
          terrain_score: "0-1, higher = flatter/lower = more flood prone",
          impervious_surface: "0-1, fraction of concrete/asphalt",
          vegetation: "0-1, higher = more trees = better drainage/cooling",
        },
      });
    }

    case "run_risk_analysis": {
      const location = String(args.location ?? "");
      const radiusKm = clamp(Number(args.radius_km ?? 2), 0.5, 25);
      const geo = await geocode(location);
      if (!geo) return `Could not find "${location}".`;

      const delta = radiusKm / 111;
      const bbox = {
        west: geo.lon - delta,
        south: geo.lat - delta,
        east: geo.lon + delta,
        north: geo.lat + delta,
      };

      actions.setAOI(bbox);
      actions.setMode("advanced");
      actions.flyTo({ lat: geo.lat, lon: geo.lon, zoom: 13 });
      actions.setRunning(true);

      try {
        const run = await api.analysis.run({ bbox, simulation_engine: "null" });
        const result = await api.analysis.poll(run.run_id, 2000, 120_000);

        const validImages = (result.images ?? []).filter(
          (img: { url?: string }) => img.url && img.url.trim() !== ""
        );

        if (validImages.length > 0) {
          actions.setData({
            trajectory: validImages.map((img, i) => ({
              lat: img.lat,
              lon: img.lon,
              elevation: 0,
              image_id: img.id ?? `img-${i}`,
            })),
            images: validImages.map((img) => ({
              id: img.id,
              url: img.url,
              lat: img.lat,
              lon: img.lon,
            })),
            profile: [],
          });
        }

        actions.setRiskResults(result.flood_layers ?? [], result.heat_layers ?? []);
        actions.setLastAnalysisDurationSeconds(null);
        actions.flyTo({
          lat: (bbox.north + bbox.south) / 2,
          lon: (bbox.east + bbox.west) / 2,
          zoom: 13,
        });

        return JSON.stringify({
          action: "analysis_completed",
          location: cleanLocationName(geo.display_name),
          bbox,
          status: result.status,
          flood_layers: result.flood_layers?.length ?? 0,
          heat_layers: result.heat_layers?.length ?? 0,
          images_fetched: validImages.length,
          note: validImages.length
            ? "Risk polygons rendered. Street images loaded in advanced mode."
            : "Risk polygons rendered. No street images found (Mapillary coverage may be limited).",
        });
      } catch (error) {
        return `Analysis failed: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        actions.setRunning(false);
      }
    }

    case "clear_map_overlays": {
      actions.clearAssistantRoute();
      actions.setDrawnPath(null);
      return JSON.stringify({ action: "assistant_overlays_cleared" });
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

function formatToolResult(name: string, result: string) {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const loc = cleanLocationName(String(parsed.location ?? "location"));
    switch (name) {
      case "geocode_location":
        return `📍 Flew to ${loc}`;
      case "set_waypoints":
        return `🛣️ Route · ${String(parsed.route_distance_km ?? "?")} km · ~${String(parsed.route_duration_min ?? "?")} min`;
      case "get_weather":
        return `🌦️ Weather loaded for ${loc}`;
      case "get_risk_summary":
        return parsed.error ? `⚠️ ${String(parsed.error)}` : "📊 Risk summary ready";
      case "run_risk_analysis":
        return `✅ Analysis complete · ${loc}`;
      case "clear_map_overlays":
        return "🧹 Overlays cleared";
      default:
        return "✓ Done";
    }
  } catch {
    return result.length > 140 ? `${result.slice(0, 140)}…` : result;
  }
}

function formatMarkdown(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="rounded bg-slate-900 px-1 py-0.5 font-mono text-[11px] text-cyan-300">$1</code>')
    .replace(/^- /gm, "• ");
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, index) => (
        <span key={`${index}-${line}`}>
          <span dangerouslySetInnerHTML={{ __html: formatMarkdown(line) }} />
          {index < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </>
  );
}

function AssistantTyping() {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
        ✦
      </div>
      <div className="flex items-center gap-1.5 rounded-[22px] border border-white/[0.08] bg-white/[0.04] px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-cyan-400/60 animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function GeoAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I'm **GeoAI**. I can navigate the map, plan routes, fetch weather, and run flood/heat risk analysis.\n\nWhat would you like to explore?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const flyTo = useAnalysisStore((s) => s.flyTo);
  const setAOI = useAnalysisStore((s) => s.setAOI);
  const setRunning = useAnalysisStore((s) => s.setRunning);
  const setMode = useAnalysisStore((s) => s.setMode);
  const setData = useAnalysisStore((s) => s.setData);
  const setRiskResults = useAnalysisStore((s) => s.setRiskResults);
  const setLastAnalysisDurationSeconds = useAnalysisStore((s) => s.setLastAnalysisDurationSeconds);
  const setAssistantWaypoints = useAnalysisStore((s) => s.setAssistantWaypoints);
  const setAssistantRoute = useAnalysisStore((s) => s.setAssistantRoute);
  const clearAssistantRoute = useAnalysisStore((s) => s.clearAssistantRoute);
  const setDrawnPath = useAnalysisStore((s) => s.setDrawnPath);

  // Watch store changes to re-render contextual suggestions
  const floodLayers = useAnalysisStore((s) => s.floodLayers);
  const aoi = useAnalysisStore((s) => s.aoi);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = "0px";
    const nextHeight = Math.min(inputRef.current.scrollHeight, 180);
    inputRef.current.style.height = `${nextHeight}px`;
  }, [input]);

  const actions = {
    flyTo,
    setAOI,
    setRunning,
    setMode,
    setData,
    setRiskResults,
    setLastAnalysisDurationSeconds,
    setAssistantWaypoints,
    setAssistantRoute,
    clearAssistantRoute,
    setDrawnPath,
  };

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setInput("");

      const userMessage: Message = { id: genId(), role: "user", content: trimmed };
      setMessages((prev) => [...prev, userMessage]);

      const currentAoi = useAnalysisStore.getState().aoi;
      const weatherShortcut = currentAoi && isWeatherQuestion(trimmed) && isVagueLocation(trimmed);
      const identityShortcut = currentAoi && isPlaceIdentityQuestion(trimmed);

      if (identityShortcut) {
        const center = {
          lat: (currentAoi.north + currentAoi.south) / 2,
          lon: (currentAoi.east + currentAoi.west) / 2,
        };

        try {
          const placeName = await reverseGeocode(center.lat, center.lon);
          setMessages((prev) => [
            ...prev,
            {
              id: genId(),
              role: "assistant",
              content: placeName
                ? `This looks like ${placeName}.`
                : `This area is centered at ${center.lat.toFixed(4)}, ${center.lon.toFixed(4)}.`,
            },
          ]);
        } catch (error) {
          setMessages((prev) => [
            ...prev,
            {
              id: genId(),
              role: "assistant",
              content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ]);
        } finally {
          setLoading(false);
        }

        return;
      }

      if (weatherShortcut) {
        const center = {
          lat: (currentAoi.north + currentAoi.south) / 2,
          lon: (currentAoi.east + currentAoi.west) / 2,
        };

        const toolMessageId = genId();
        setMessages((prev) => [
          ...prev,
          {
            id: toolMessageId,
            role: "tool",
            toolName: "get_weather",
            content: "Checking the current analyzed area from the store...",
          },
        ]);

        try {
          const weather = (await api.weather.get(center.lat, center.lon, 7)) as {
            mean_temp_c: number;
            total_rainfall_mm: number;
            peak_intensity_mm_hr: number;
            provider: string;
          };
          const summary = [
            `Weather for the current analyzed area (${center.lat.toFixed(4)}, ${center.lon.toFixed(4)}):`,
            `• Mean temperature: ${Number(weather.mean_temp_c).toFixed(1)}°C`,
            `• Rainfall: ${Number(weather.total_rainfall_mm).toFixed(1)} mm`,
            `• Peak intensity: ${Number(weather.peak_intensity_mm_hr).toFixed(1)} mm/hr`,
            `• Source: ${String(weather.provider)}`,
          ].join("\n");

          setMessages((prev) => [
            ...prev,
            { id: genId(), role: "assistant", content: summary },
          ]);
        } catch (error) {
          setMessages((prev) => [
            ...prev,
            {
              id: genId(),
              role: "assistant",
              content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ]);
        } finally {
          setLoading(false);
        }

        return;
      }

      const recentMessages = messages
        .filter((m) => m.role !== "tool")
        .slice(-4)
        .map((m) => ({ role: m.role, content: m.content }));

      const conversation: AssistantChatMessage[] = [
        { role: "system", content: buildSystemPrompt() },
        ...recentMessages,
        { role: "user", content: trimmed },
      ];

      try {
        for (let iteration = 0; iteration < 6; iteration += 1) {
          const response = await api.assistant.chat(
            {
              model: GROQ_MODEL,
              messages: conversation,
              tools: TOOLS as unknown as unknown[],
              tool_choice: "auto",
              temperature: 0.2,
              max_tokens: 1200,
            },
            { signal: controller.signal }
          );

          const assistantMessage = response.choices?.[0]?.message;
          const content = assistantMessage?.content ?? "";
          const toolCalls = (assistantMessage?.tool_calls as ToolCall[] | undefined) ?? [];

          if (content) {
            setMessages((prev) => [...prev, { id: genId(), role: "assistant", content }]);
          }

          conversation.push({ role: "assistant", content, tool_calls: toolCalls });

          if (!toolCalls.length) break;

          for (const toolCall of toolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(toolCall.function.arguments || "{}");
            } catch {
              args = {};
            }

            const toolMessageId = genId();
            const summary =
              toolCall.function.name === "set_waypoints" && Array.isArray(args.waypoints)
                ? `Routing ${(args.waypoints as string[]).join(" → ")}`
                : toolCall.function.name === "geocode_location" && args.location
                  ? `Finding ${String(args.location)}`
                  : toolCall.function.name === "run_risk_analysis" && args.location
                    ? `Analyzing ${String(args.location)}`
                    : `Running ${toolCall.function.name}`;

            setMessages((prev) => [
              ...prev,
              { id: toolMessageId, role: "tool", toolCallId: toolCall.id, toolName: toolCall.function.name, content: summary },
            ]);

            const result = await executeTool(toolCall.function.name, args, actions);
            const shortResult = formatToolResult(toolCall.function.name, result);

            setMessages((prev) =>
              prev.map((m) => (m.id === toolMessageId ? { ...m, content: shortResult } : m))
            );

            conversation.push({ role: "tool", content: result, tool_call_id: toolCall.id });
          }
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setMessages((prev) => [
            ...prev,
            { id: genId(), role: "assistant", content: `Error: ${error instanceof Error ? error.message : String(error)}` },
          ]);
        }
      } finally {
        setLoading(false);
      }
    },
    [actions, loading, messages]
  );

  const sendCurrent = useCallback(() => void sendText(input), [input, sendText]);

  const stopGeneration = useCallback(() => {
    if (!loading) return;
    abortRef.current?.abort();
    setLoading(false);
    setMessages((prev) => [...prev, { id: genId(), role: "assistant", content: "Stopped." }]);
  }, [loading]);

  const clearChat = useCallback(() => {
    setMessages([{ id: genId(), role: "assistant", content: "Chat cleared. How can I help?" }]);
  }, []);

  // Recompute suggestions reactively when store changes
  const suggestions = getContextualSuggestions();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void floodLayers; void aoi; // consumed above via getContextualSuggestions

  return (
    <section className="flex h-full w-full flex-col overflow-hidden bg-[#08101f] border-0">
      {/* Header */}
      <header className="border-b border-white/5 bg-gradient-to-r from-cyan-500/10 via-blue-500/8 to-fuchsia-500/10 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300 text-sm">
              ✦
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-slate-50">GeoAI Assistant</h2>
              <p className="text-[10px] uppercase tracking-widest text-cyan-400/60">map · risk · weather</p>
            </div>
          </div>
          <button
            type="button"
            onClick={clearChat}
            title="Clear chat"
            className="rounded-lg border border-white/8 bg-white/[0.03] p-1.5 text-slate-500 transition hover:border-white/15 hover:text-slate-300"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
            </svg>
          </button>
        </div>

        {/* Contextual suggestions */}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void sendText(s)}
              disabled={loading}
              className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-400 transition hover:border-cyan-400/25 hover:bg-cyan-400/[0.07] hover:text-slate-200 disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-3 py-4"
        style={{ minHeight: 0 }}
      >
        <div className="space-y-4">
          {messages.map((message) => {
            if (message.role === "user") {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-cyan-400/15 bg-cyan-500/10 px-4 py-2.5 text-sm leading-relaxed text-slate-100">
                    <MarkdownText text={message.content} />
                  </div>
                </div>
              );
            }

            if (message.role === "tool") {
              return (
                <div key={message.id} className="flex items-center gap-2 px-1">
                  <span className="text-slate-600 text-xs">⌁</span>
                  <span className="text-[11px] text-slate-500">
                    <MarkdownText text={message.content} />
                  </span>
                </div>
              );
            }

            return (
              <div key={message.id} className="flex items-start gap-2.5">
                <div className="mt-0.5 flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/10 text-cyan-300 text-xs">
                  ✦
                </div>
                <div className="flex-1 min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.035] px-4 py-3 text-sm leading-relaxed text-slate-100">
                  <MarkdownText text={message.content} />
                </div>
              </div>
            );
          })}

          {loading && <AssistantTyping />}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 px-3 py-3 bg-[#060d1a]">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendCurrent();
              }
            }}
            placeholder="Ask anything..."
            className="min-h-[42px] flex-1 min-w-0 resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/30 focus:bg-white/[0.06] transition-all"
            rows={1}
          />
          {loading ? (
            <button
              type="button"
              onClick={stopGeneration}
              className="flex-shrink-0 inline-flex h-[42px] w-[42px] items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 transition-all"
              title="Stop"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
                <rect x="2" y="2" width="8" height="8" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              disabled={!input.trim()}
              onClick={sendCurrent}
              className="flex-shrink-0 inline-flex h-[42px] w-[42px] items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300 hover:border-cyan-300/40 hover:bg-cyan-400/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title="Send"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m22 2-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}