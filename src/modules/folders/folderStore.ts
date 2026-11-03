import { create } from "zustand";
import type { Folder } from "@/lib/tauri";
import * as api from "@/lib/tauri";

interface FolderStore {
  folders: Folder[];
  spaceId: string | null;
  loading: boolean;
  setActiveSpace: (spaceId: string) => void;
  fetch: (spaceId: string) => Promise<void>;
  create: (spaceId: string, name: string) => Promise<string>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useFolderStore = create<FolderStore>((set, get) => ({
  folders: [],
  spaceId: null,
  loading: false,

  setActiveSpace: (spaceId) => {
    if (get().spaceId !== spaceId) {
      set({ spaceId, folders: [] });
      get().fetch(spaceId);
    }
  },

  fetch: async (spaceId) => {
    set({ loading: true });
    const folders = await api.listFolders(spaceId);
    set({ folders, loading: false });
  },

  create: async (spaceId, name) => {
    const id = await api.createFolder(spaceId, name);
    await get().fetch(spaceId);
    return id;
  },

  rename: async (id, name) => {
    await api.renameFolder(id, name);
    const spaceId = get().spaceId;
    if (spaceId) await get().fetch(spaceId);
  },

  remove: async (id) => {
    await api.deleteFolder(id);
    set((s) => ({ folders: s.folders.filter((f) => f.id !== id) }));
  },
}));
