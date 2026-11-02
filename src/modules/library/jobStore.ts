import { create } from "zustand";
import type { Job } from "@/lib/tauri";
import * as api from "@/lib/tauri";

interface JobStore {
  jobs: Job[];
  loading: boolean;
  activeProjectId: string | null;
  setActiveProject: (id: string) => void;
  fetch: (projectId: string) => Promise<void>;
  create: (projectId: string, filePath: string, whisperModel: string) => Promise<string>;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  updateStatus: (id: string, status: Job["status"]) => void;
}

export const useJobStore = create<JobStore>((set, get) => ({
  jobs: [],
  loading: false,
  activeProjectId: null,

  setActiveProject: (id) => {
    set({ activeProjectId: id });
    get().fetch(id);
  },

  fetch: async (projectId) => {
    set({ loading: true });
    const jobs = await api.listJobsByProject(projectId);
    set({ jobs, loading: false });
  },

  create: async (projectId, filePath, whisperModel) => {
    const id = await api.createJob(projectId, filePath, whisperModel);
    await get().fetch(projectId);
    return id;
  },

  cancel: async (id) => {
    await api.cancelJob(id);
  },

  remove: async (id) => {
    await api.deleteJob(id);
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
  },

  updateStatus: (id, status) => {
    set((s) => ({
      jobs: s.jobs.map((j) => {
        if (j.id !== id) return j;
        // Don't overwrite "recording" with "running" — live chunks arrive while still recording
        if (j.status === "recording" && status === "running") return j;
        return { ...j, status };
      }),
    }));
  },
}));
