import { create } from "zustand";

export type Mode = "simple" | "advanced";

export interface TrajectoryPoint {
  lat: number;
  lon: number;
  elevation: number;
  image_id: string;
}

export interface ImagePoint {
  id: string;
  url: string;
  lat: number;
  lon: number;
}

export interface ProfilePoint {
  distance: number;
  elevation: number;
  slope: number;
}

export interface AOI {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface AnalysisStore {
  mode: Mode;
  currentIndex: number;
  trajectory: TrajectoryPoint[];
  images: ImagePoint[];
  profile: ProfilePoint[];
  isPlaying: boolean;
  aoi: AOI | null;
  isRunning: boolean;

  setIndex: (index: number) => void;
  setAOI: (aoi: AOI | null) => void;
  setMode: (mode: Mode) => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  setData: (payload: {
    trajectory: TrajectoryPoint[];
    images: ImagePoint[];
    profile: ProfilePoint[];
  }) => void;
  setRunning: (running: boolean) => void;
}

function clampIndex(index: number, len: number) {
  if (len <= 0) return 0;
  if (index < 0) return 0;
  if (index >= len) return len - 1;
  return index;
}

export const useAnalysisStore = create<AnalysisStore>((set, get) => ({
  mode: "simple",
  currentIndex: 0,
  trajectory: [],
  images: [],
  profile: [],
  isPlaying: false,
  aoi: null,
  isRunning: false,

  setIndex: (index) =>
    set((state) => ({
      currentIndex: clampIndex(index, state.trajectory.length),
    })),

  setAOI: (aoi) => set({ aoi }),
  setMode: (mode) => set({ mode }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),

  next: () =>
    set((state) => {
      if (!state.trajectory.length) return state;
      const last = state.trajectory.length - 1;
      if (state.currentIndex >= last) return { currentIndex: last, isPlaying: false };
      return { currentIndex: state.currentIndex + 1 };
    }),

  prev: () =>
    set((state) => ({
      currentIndex: clampIndex(state.currentIndex - 1, state.trajectory.length),
    })),

  setData: ({ trajectory, images, profile }) =>
    set({
      trajectory,
      images,
      profile,
      currentIndex: 0,
      mode: "advanced",
      isPlaying: false,
      isRunning: false,
    }),

  setRunning: (isRunning) => set({ isRunning }),
}));

export function currentImageFromStore() {
  const { images, currentIndex } = useAnalysisStore.getState();
  if (!images.length) return null;
  return images[clampIndex(currentIndex, images.length)];
}
