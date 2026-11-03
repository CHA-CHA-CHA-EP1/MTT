import { create } from "zustand";
import type { Space } from "@/lib/tauri";
import * as api from "@/lib/tauri";

interface SpaceStore {
  spaces: Space[];
  loading: boolean;
  fetch: () => Promise<void>;
  create: (name: string) => Promise<string>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useSpaceStore = create<SpaceStore>((set, get) => ({
  spaces: [],
  loading: false,

  fetch: async () => {
    set({ loading: true });
    const spaces = await api.listSpaces();
    set({ spaces, loading: false });
  },

  create: async (name) => {
    const id = await api.createSpace(name);
    await get().fetch();
    return id;
  },

  rename: async (id, name) => {
    await api.renameSpace(id, name);
    await get().fetch();
  },

  remove: async (id) => {
    await api.deleteSpace(id);
    set((s) => ({ spaces: s.spaces.filter((sp) => sp.id !== id) }));
  },
}));
