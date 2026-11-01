import { invoke } from "@tauri-apps/api/core";

export interface Project {
  id: string;
  name: string;
  created_at: number;
}

export interface Job {
  id: string;
  project_id: string;
  file_path: string;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  whisper_model: string;
  created_at: number;
}

export interface Segment {
  id: number;
  job_id: string;
  idx: number;
  start: number;
  end: number;
  text: string;
  corrected_text: string | null;
  suspect: boolean;
}

// Projects
export const createProject = (name: string) =>
  invoke<string>("create_project", { name });

export const listProjects = () =>
  invoke<Project[]>("list_projects");

export const getProject = (id: string) =>
  invoke<Project>("get_project", { id });

export const renameProject = (id: string, name: string) =>
  invoke<void>("rename_project", { id, name });

export const deleteProject = (id: string) =>
  invoke<void>("delete_project", { id });

// Jobs
export const initWorker = (whisperModel: string) =>
  invoke<void>("init_worker", { whisperModel });

export const createJob = (projectId: string, filePath: string, whisperModel: string) =>
  invoke<string>("create_job", { projectId, filePath, whisperModel });

export const cancelJob = (id: string) =>
  invoke<void>("cancel_job", { id });

export const deleteJob = (id: string) =>
  invoke<void>("delete_job", { id });

export const listJobsByProject = (projectId: string) =>
  invoke<Job[]>("list_jobs_by_project", { projectId });

export const getJob = (id: string) =>
  invoke<Job>("get_job", { id });

// Segments
export const getSegments = (jobId: string) =>
  invoke<Segment[]>("get_segments", { jobId });

export const searchSegments = (query: string) =>
  invoke<Segment[]>("search_segments", { query });
