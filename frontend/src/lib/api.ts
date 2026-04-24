
import type { DrawnPathPoint } from "@/store/analysis";
import type {
  AnalysisResult,
  AnalysisRequest,
  ElevationProfileOptionsResponse,
  ElevationProfileRequest,
  ElevationProfileResponse,
  MapillaryImage,
} from "@/types";


const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
const ROOT = BASE.replace(/\/api\/v1\/?$/, "");
const _imageCache = new Map<string, MapillaryImage[]>();

export interface AssistantChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
}

export function clearImageCache() {
  _imageCache.clear();
}

function pathCacheKey(path: DrawnPathPoint[], radius: number) {
  return JSON.stringify({ path, radius });
}

function bboxCacheKey(west: number, south: number, east: number, north: number) {
  return JSON.stringify({ west, south, east, north });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function requestRoot<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ROOT}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  analysis: {
    run: (body: AnalysisRequest) =>
      request<{ run_id: string; status: string }>("/analysis/run", {
        method: "POST",
        body: JSON.stringify(body),
      }),

    get: (runId: string) =>
      request<AnalysisResult>(`/analysis/${runId}`),

    poll: async (runId: string, intervalMs = 2000, maxMs = 120_000): Promise<AnalysisResult> => {
      const deadline = Date.now() + maxMs;
      while (Date.now() < deadline) {
        const result = await api.analysis.get(runId);
        if (result.status === "completed" || result.status.startsWith("failed")) {
          return result;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      throw new Error("Analysis timed out");
    },
  },

  mapillary: {
    images: (west: number, south: number, east: number, north: number) =>
      {
        const key = bboxCacheKey(west, south, east, north);
        const cached = _imageCache.get(key);
        if (cached) return Promise.resolve(cached);

        return request<MapillaryImage[]>(
          `/mapillary/images?west=${west}&south=${south}&east=${east}&north=${north}`
        ).then((result) => {
          _imageCache.set(key, result);
          return result;
        });
      },
    imagesAlongPath: (path: DrawnPathPoint[], widthMeters: number) => {
      const key = pathCacheKey(path, widthMeters);
      const cached = _imageCache.get(key);
      if (cached) return Promise.resolve(cached);

      return request<MapillaryImage[]>('/mapillary/images/along-path', {
        method: "POST",
        body: JSON.stringify({
          path,
          width_meters: widthMeters,
        }),
      }).then((result) => {
        _imageCache.set(key, result);
        return result;
      });
    },
  },

  weather: {
    get: (lat: number, lon: number, daysBack = 7) =>
      request(`/weather?lat=${lat}&lon=${lon}&days_back=${daysBack}`),
  },

  elevation: {
    options: () => requestRoot<ElevationProfileOptionsResponse>("/profile/options"),

    profile: (body: ElevationProfileRequest) =>
      requestRoot<ElevationProfileResponse>("/profile", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },

  assistant: {
    chat: (
      body: {
        model?: string;
        messages: AssistantChatMessage[];
        tools: unknown[];
        tool_choice: string;
        temperature: number;
        max_tokens: number;
      },
      options?: { signal?: AbortSignal }
    ) =>
      request<{
        choices: {
          message: {
            content: string | null;
            tool_calls?: {
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            }[];
          };
        }[];
      }>("/assistant/chat", {
        method: "POST",
        body: JSON.stringify(body),
        signal: options?.signal,
      }),
  },
};
