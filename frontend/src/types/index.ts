export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface AnalysisRequest {
  bbox: BBox;
  project_id?: string;
  simulation_engine?: "hecras" | "null";
  weather_days_back?: number;
}

export interface ElevationProfileRequest {
  line: [number, number][];
  provider?: "ors" | "opentopography" | "opentopodata" | "openelevation" | "geonames";
  dataset?: string;
  use_fallback?: boolean;
}

export type ElevationProviderName =
  | "ors"
  | "opentopography"
  | "opentopodata"
  | "openelevation"
  | "geonames";

export interface ElevationProfileOptionsResponse {
  providers: ElevationProviderName[];
  defaults: {
    chain: string[];
    opentopodata_dataset: string;
    opentopography_demtype: string;
  };
  datasets: {
    geonames?: Record<string, { resolution?: string; endpoint?: string }>;
    opentopodata?: Record<string, { label?: string; slug?: string }>;
    opentopography?: Record<string, string>;
  };
}

export interface ElevationPoint {
  lat: number;
  lon: number;
  elevation: number;
}

export interface ElevationProfileSample {
  lat: number;
  lon: number;
  distance: number;
  elevation: number;
  slope: number;
}

export interface ElevationProfileResponse {
  provider: string;
  dataset?: string | null;
  points: ElevationPoint[];
  profile: ElevationProfileSample[];
  total_distance: number;
}

export interface RiskLayer {
  risk_type: "flood" | "heat";
  score: number;
  geometry: GeoJSON.Polygon;
  components: Record<string, unknown>;
}

export interface AnalysisResult {
  run_id: string;
  status: string;
  flood_layers: RiskLayer[];
  heat_layers: RiskLayer[];
  image_count: number;
  simulation_engine_used: string;
}

export interface MapillaryImage {
  id: string;
  lat: number;
  lon: number;
  thumb_url?: string;
  captured_at?: string;
}

export type RiskCategory = 0 | 1 | 2 | 3 | 4;

export const RISK_COLORS: Record<RiskCategory, string> = {
  0: "transparent",
  1: "#4caf50",  // low — green
  2: "#ffeb3b",  // medium — yellow
  3: "#ff9800",  // high — orange
  4: "#f44336",  // extreme — red
};
