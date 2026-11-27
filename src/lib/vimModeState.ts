import { create } from "zustand";

interface VimModeState {
  isNormalMode: boolean;
  setNormalMode: (v: boolean) => void;
}

export const useVimModeState = create<VimModeState>()((set) => ({
  isNormalMode: false,
  setNormalMode: (isNormalMode) => set({ isNormalMode }),
}));
