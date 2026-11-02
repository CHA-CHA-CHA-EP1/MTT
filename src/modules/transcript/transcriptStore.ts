import { create } from "zustand";
import type { Segment } from "@/lib/tauri";
import * as api from "@/lib/tauri";

interface TranscriptStore {
  segments: Segment[];
  activeJobId: string | null;
  activeIdx: number;
  loading: boolean;
  load: (jobId: string) => Promise<void>;
  reload: () => Promise<void>;
  appendNewSegments: () => Promise<void>;
  clearSegments: () => void;
  setCurrentTime: (t: number) => void;
  applyCorrection: (startIdx: number, texts: string[]) => void;
}

export const useTranscriptStore = create<TranscriptStore>((set, get) => ({
  segments: [],
  activeJobId: null,
  activeIdx: -1,
  loading: false,

  load: async (jobId) => {
    set({ loading: true, activeJobId: jobId, activeIdx: -1 });
    const segments = await api.getSegments(jobId);
    set({ segments, loading: false });
  },

  reload: async () => {
    const { activeJobId } = get();
    if (!activeJobId) return;
    const segments = await api.getSegments(activeJobId);
    set({ segments });
  },

  clearSegments: () => set({ segments: [], activeIdx: -1 }),

  // Fetch only segments added since the last known idx — avoids re-fetching
  // the full list on every live recording chunk event.
  appendNewSegments: async () => {
    const { activeJobId, segments } = get();
    if (!activeJobId) return;
    const lastIdx = segments.length > 0 ? segments[segments.length - 1].idx : -1;
    const newSegs = await api.getSegmentsSince(activeJobId, lastIdx + 1);
    if (newSegs.length > 0) {
      set((s) => ({ segments: [...s.segments, ...newSegs] }));
    }
  },

  // Only update store state when active segment boundary is crossed,
  // not on every timeupdate tick — prevents full list re-render during playback.
  setCurrentTime: (t) => {
    const { segments, activeIdx } = get();
    const newIdx = segments.findIndex((s) => t >= s.start && t < s.end);
    if (newIdx !== activeIdx) set({ activeIdx: newIdx });
  },

  applyCorrection: (startIdx, texts) => {
    set((s) => ({
      segments: s.segments.map((seg) => {
        const offset = seg.idx - startIdx;
        if (offset >= 0 && offset < texts.length)
          return { ...seg, corrected_text: texts[offset] };
        return seg;
      }),
    }));
  },
}));
