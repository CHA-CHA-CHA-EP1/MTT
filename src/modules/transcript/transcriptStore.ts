import { create } from "zustand";
import type { Segment } from "@/lib/tauri";
import * as api from "@/lib/tauri";

interface TranscriptStore {
  segments: Segment[];
  activeJobId: string | null;
  currentTime: number;
  loading: boolean;
  load: (jobId: string) => Promise<void>;
  reload: () => Promise<void>;
  setCurrentTime: (t: number) => void;
  applyCorrection: (startIdx: number, texts: string[]) => void;
  activeSegmentIdx: () => number;
}

export const useTranscriptStore = create<TranscriptStore>((set, get) => ({
  segments: [],
  activeJobId: null,
  currentTime: 0,
  loading: false,

  load: async (jobId) => {
    set({ loading: true, activeJobId: jobId });
    const segments = await api.getSegments(jobId);
    set({ segments, loading: false });
  },

  reload: async () => {
    const { activeJobId } = get();
    if (!activeJobId) return;
    const segments = await api.getSegments(activeJobId);
    set({ segments });
  },

  setCurrentTime: (t) => set({ currentTime: t }),

  applyCorrection: (startIdx, texts) => {
    set((s) => ({
      segments: s.segments.map((seg) => {
        const offset = seg.idx - startIdx;
        if (offset >= 0 && offset < texts.length) {
          return { ...seg, corrected_text: texts[offset] };
        }
        return seg;
      }),
    }));
  },

  activeSegmentIdx: () => {
    const { segments, currentTime } = get();
    return segments.findIndex(
      (s) => currentTime >= s.start && currentTime < s.end
    );
  },
}));
