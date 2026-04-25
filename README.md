# GeoAI RiskMapper

> A full-stack geospatial platform for real-time **flood** and **urban heat** risk analysis — powered by terrain modeling, weather history, computer vision, hydraulic simulation, and an AI assistant.

🎥 **[Watch Demo](https://drive.google.com/file/d/1-Pjx4coFBMAU8AkP4fMZeqei1s-zfS77/view)**

---

## Screenshots

| Default View | OSM + Routing |
|---|---|
| ![Default View](docs/image_.jpeg) | ![OSM Routing](docs/image_osm.jpg) |

| Satellite + Routing | Advanced Mode |
|---|---|
| ![Satellite](docs/image_satellite.jpg) | ![Advanced Mode](docs/image_advanced_mode.jpg) |
---

## Features

- 🗺️ **Dual map modes** — OpenStreetMap and satellite imagery
- 📍 **Waypoint routing** — draw a path, get a navigable route
- 🌊 **Flood risk analysis** — per-cell scoring from terrain + rainfall + simulation + street imagery
- 🌡️ **Heat risk analysis** — Urban Heat Island scoring from temperature + impervious surfaces + vegetation
- 📷 **Street-level vision** — Mapillary images analyzed by SegFormer, Groq vision, or CLIP
- 🤖 **GeoAI Assistant** — Groq-powered chatbot with tool-calling for routing, analysis, and weather
- 📊 **Advanced mode** — elevation profile, risk stats panel, image viewer, trajectory playback
- ⚡ **Redis caching** — weather (1h TTL) and DEM (24h TTL) to avoid redundant API calls

---

## Architecture

```
┌──────────────────────────────────────────────┐
│              Frontend  (Next.js 14)           │
│  MapView · RiskMap · WaypointRouter           │
│  GeoAssistant · ProfileChart · RiskStatsPanel │
│  Zustand store  (useAnalysisStore)            │
└────────────────────┬─────────────────────────┘
                     │ REST / SSE
┌────────────────────▼─────────────────────────┐
│              Backend  (FastAPI)               │
│                                               │
│  /analysis  /assistant  /weather              │
│  /routing   /mapillary  /profile              │
│                                               │
│  ┌─────────────────────────────────────────┐ │
│  │          AnalysisPipeline               │ │
│  │  Fetch → Process → Simulate → Score     │ │
│  │  → GeoJSON Export                       │ │
│  └─────────────────────────────────────────┘ │
│                                               │
│  Providers:  Open-Meteo · SRTM · Mapillary    │
│  Cache:      Redis                            │
│  Simulation: HEC-RAS | NullEngine             │
└──────────────────────────────────────────────┘
```

---

## Analysis Pipeline

`AnalysisPipeline.run()` in `fusion/pipeline.py` — five ordered stages:

### Stage 1 — Data Fetching (concurrent)

All sources fetched in parallel via `asyncio.gather`:

| Source | Provider | Cache TTL |
|--------|----------|-----------|
| Historical weather | Open-Meteo | 1 hour |
| Digital Elevation Model | SRTM | 24 hours |
| Street-level images | Mapillary | none |

Redis caches weather and DEM results. Mapillary failures are silently ignored — the pipeline continues with an empty image list.

### Stage 2 — Processing

| Analyzer | Input | Output |
|----------|-------|--------|
| `TerrainAnalyzer` | DEM grid | elevation, slope (°), flow accumulation (D8) |
| `WeatherAnalyzer` | Weather history | flood trigger score, heat stress, rainfall totals |
| `VisionAnalyzer` | Mapillary images | impervious %, vegetation %, shadow %, standing water % |

### Stage 3 — Simulation

| Engine | Description |
|--------|-------------|
| `HEC-RAS` | Full hydraulic simulation → `flood_extent_array` + `flood_depth_array` |
| `NullEngine` | Statistical fallback — produces a weaker extent array; its 25% weight is redistributed to terrain/weather |

Active engine set via `SIMULATION_ENGINE=null|hecras` in `.env`.

### Stage 4 — Risk Scoring

`FloodRiskEngine` and `HeatRiskEngine` each produce a per-cell NumPy score grid `[0, 1]`, a category grid `(0=none … 4=extreme)`, and a `components` dict for UI explainability.

### Stage 5 — GeoJSON Export

`grid_to_geojson_polygons()` converts score/category grids into GeoJSON `Polygon` features rendered directly on the map.

---

## Risk Engines

### Flood Risk Engine

| Factor | Weight | Notes |
|--------|--------|-------|
| Weather | 35% | Rainfall total + peak intensity |
| Terrain | 30% | Elevation + slope + flow accumulation |
| Simulation | 25% | 0% with NullEngine; redistributed to terrain/weather |
| Vision | 10% | Impervious surface + standing water |

**Terrain score (per cell):**
```
terrain = 0.4 × (1 − norm_elevation)
        + 0.3 × (1 − clip(slope / 30°))
        + 0.3 × norm(log(flow_accumulation + 1))
```

**Derived display metrics:** runoff coefficient (Rational Method), peak flow index, drainage index, high-risk cell %, max flow accumulation.

### Heat Risk Engine

```
heat_score = temp_baseline            ← dominant (15°C→0, 40°C→1)
           + heat_stress × 0.25
           + impervious × 0.25        ← Urban Heat Island proxy
           − vegetation × 0.15        ← cooling
           − shadow × 0.10            ← cooling
           − elevation_norm × 0.05    ← lapse rate
```

**Derived display metrics:** UHI intensity (°C), simplified Steadman heat index, cooling deficit, drought days.

---

## Vision Analysis

`VisionAnalyzer` processes each Mapillary image through a **fallback chain**:

```
SegFormer (HuggingFace) → Groq Vision → CLIP (local) → Mock
```

| Model | How it works |
|-------|-------------|
| **SegFormer** `nvidia/segformer-b0-finetuned-cityscapes-640-640` | Pixel-level Cityscapes segmentation via HF Inference API. Decodes base64 PNG masks → computes per-label pixel fractions (vegetation, impervious, water, sky) |
| **Groq Vision** `llama-3.2-11b-vision-preview` | Prompts the model to return a JSON object with `vegetation_score`, `impervious_score`, `shadow_score`, `standing_water`, `surface_type` |
| **CLIP** `openai/clip-vit-base-patch32` | Zero-shot classification against 5 text labels, run locally via HuggingFace `transformers` |
| **Mock** | Seeded random values — used in tests or when all APIs are unavailable |

Set with `CV_MODEL=segformer|groq|clip|mock`.

---

## GeoAI Assistant

The assistant (`/api/v1/assistant/chat`) is a **Groq tool-calling agent** backed by `llama-3.3-70b-versatile`.

**Flow:**

1. Frontend sends `messages[]` + `tools[]` to the backend
2. Backend proxies to Groq (`/openai/v1/chat/completions`) with `tool_choice: auto`
3. Groq returns a `tool_use` response — frontend executes the tool locally
4. Frontend sends the tool result back as a `tool` role message
5. Loop repeats until Groq returns a plain text answer

**Endpoints:**

| Endpoint | Mode |
|----------|------|
| `POST /assistant/chat` | Standard JSON response |
| `POST /assistant/chat/stream` | SSE streaming (token-by-token) |

**Tool examples registered by the frontend:**
- `run_analysis` — triggers the full risk pipeline for a bbox
- `get_weather` — fetches weather for coordinates
- `route_waypoints` — plans a path between waypoints
- `fly_to` — pans the map camera (updates `flyToTarget` in Zustand)

---

## Frontend State (Zustand)

All shared UI state lives in `useAnalysisStore`:

| Slice | Description |
|-------|-------------|
| `mode` | `simple` (map only) or `advanced` (full analysis UI) |
| `aoi` / `drawnPath` | Current area of interest or freehand path |
| `floodLayers` / `heatLayers` | GeoJSON risk features from last analysis |
| `activeLayer` | Which risk overlay is visible (`flood` or `heat`) |
| `trajectory` / `profile` | Elevation profile points for playback |
| `images` | Mapillary image points for the image viewer |
| `assistantWaypoints` / `assistantRoute` | Route generated by the AI assistant |
| `flyToTarget` | Map camera target set by the assistant |
| `lastAnalysisDurationSeconds` | Performance display in the stats panel |

---

## Redis Caching

| Key pattern | TTL | Data |
|-------------|-----|------|
| `weather:{lat}:{lon}:{days}` | 1 hour | `WeatherSummary` JSON |
| `dem:{west}:{south}:{east}:{north}` | 24 hours | `DEMData` JSON |

Coordinates are snapped to `0.01°` precision to avoid near-duplicate cache misses. If Redis is unavailable, the pipeline falls back to live fetches transparently.

---

## Getting Started

### Run with Docker

```bash
git clone https://github.com/your-org/GeoAI-RiskMapper.git
cd GeoAI-RiskMapper
cp .env.example .env   # fill in your keys
docker compose -f infra/docker-compose.yml up --build
```

- Frontend → http://localhost:3000
- Backend API → http://localhost:8000/docs

### Environment Variables

```env
APP_NAME=GeoAI Risk Engine
DATABASE_URL=postgresql+asyncpg://geoai:geoai@localhost:5432/geoai
REDIS_URL=redis://localhost:6379

MAPILLARY_ACCESS_TOKEN=your_token
GROQ_API_KEY=your_key
GROQ_MODEL=llama-3.3-70b-versatile
HF_API_KEY=your_key
ORS_API_KEY=your_key
GEONAMES_USERNAME=your_username
OPENTOPOGRAPHY_API_KEY=your_key

WEATHER_PROVIDER=open_meteo
DEM_PROVIDER=srtm
ELEVATION_OPENTOPODATA_DATASET=srtm90m
ELEVATION_OPENTOPOGRAPHY_DEMTYPE=SRTMGL1

SIMULATION_ENGINE=null        # null | hecras
HECRAS_MCP_URL=http://localhost:8001
CV_MODEL=segformer             # segformer | groq | clip | mock
```

### Run Locally

```bash
# Backend
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm install && npm run dev
```

---

## Project Structure

```
.
├── backend/app/
│   ├── api/routes/        # FastAPI endpoints
│   ├── core/              # Config, DB, Redis
│   ├── data_providers/    # SRTM, Open-Meteo, Mapillary
│   ├── elevation/         # Multi-provider elevation catalog
│   ├── fusion/            # AnalysisPipeline + GeoJSON export
│   ├── processing/        # Terrain, Weather, Vision analyzers
│   ├── risk_engine/       # FloodRiskEngine, HeatRiskEngine
│   └── simulation/        # HEC-RAS + NullEngine
├── frontend/src/
│   ├── components/        # Map, analysis panels, assistant UI
│   ├── store/             # Zustand (useAnalysisStore)
│   └── lib/               # API client
├── docs/                  # Platform screenshots
├── infra/                 # docker-compose.yml, schema.sql
└── README.md
```

---

## License

MIT