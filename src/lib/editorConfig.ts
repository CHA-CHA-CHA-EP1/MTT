import { create } from "zustand";
import { persist } from "zustand/middleware";

interface EditorStore {
  vimMode: boolean;
  setVimMode: (v: boolean) => void;
}

export const useEditorStore = create<EditorStore>()(
  persist(
    (set) => ({
      vimMode: false,
      setVimMode: (vimMode) => set({ vimMode }),
    }),
    { name: "mtt-editor" }
  )
);
