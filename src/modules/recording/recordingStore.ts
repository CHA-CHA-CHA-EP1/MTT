import { create } from "zustand";

interface RecordingStore {
  windowId: number | null;
  setWindowId: (id: number | null) => void;
}

export const useRecordingStore = create<RecordingStore>((set) => ({
  windowId: null,
  setWindowId: (id) => set({ windowId: id }),
}));
