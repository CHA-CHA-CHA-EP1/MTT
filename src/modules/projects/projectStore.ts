import { create } from "zustand";
import type { Project } from "@/lib/tauri";
import * as api from "@/lib/tauri";

interface ProjectStore {
  projects: Project[];
  loading: boolean;
  fetch: () => Promise<void>;
  create: (name: string) => Promise<string>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  loading: false,

  fetch: async () => {
    set({ loading: true });
    const projects = await api.listProjects();
    set({ projects, loading: false });
  },

  create: async (name) => {
    const id = await api.createProject(name);
    await get().fetch();
    return id;
  },

  rename: async (id, name) => {
    await api.renameProject(id, name);
    await get().fetch();
  },

  remove: async (id) => {
    await api.deleteProject(id);
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
  },
}));
