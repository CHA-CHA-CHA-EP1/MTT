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
  status: "pending" | "running" | "done" | "error" | "cancelled" | "recording";
  whisper_model: string;
  created_at: number;
  recording_window?: string | null;
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

export const getSegmentsSince = (jobId: string, minIdx: number) =>
  invoke<Segment[]>("get_segments_since", { jobId, minIdx });

export const searchSegments = (query: string) =>
  invoke<Segment[]>("search_segments", { query });

export const searchSegmentsInJob = (jobId: string, query: string) =>
  invoke<Segment[]>("search_segments_in_job", { jobId, query });

export const updateSegment = (segmentId: number, text: string | null) =>
  invoke<void>("update_segment", { segmentId, text });

// AI Config
export type AiProvider = "anthropic" | "openai" | "custom";

export interface AiConfig {
  provider: AiProvider;
  api_key: string;
  base_url?: string;
  model: string;
}

export const PROVIDER_DEFAULTS: Record<AiProvider, { label: string; base_url?: string; model: string }> = {
  anthropic: { label: "Anthropic (Claude)", model: "claude-sonnet-4-6" },
  openai: { label: "OpenAI", model: "gpt-4o" },
  custom: { label: "Custom / LiteLLM", model: "" },
};

export const getAiConfig = () =>
  invoke<AiConfig | null>("get_ai_config");

export const saveAiConfig = (config: AiConfig) =>
  invoke<void>("save_ai_config", { config });

export const listAiModels = (config: AiConfig) =>
  invoke<string[]>("list_ai_models", { config });

export const testAiConnection = (config: AiConfig) =>
  invoke<void>("test_ai_connection", { config });

// Summary config
export interface SummaryConfig {
  prompt: string;
  model: string;
}

export const getSummaryConfig = () =>
  invoke<SummaryConfig>("get_summary_config");

export const saveSummaryConfig = (config: SummaryConfig) =>
  invoke<void>("save_summary_config", { config });

// Summary
export const getJobSummary = (jobId: string) =>
  invoke<string | null>("get_job_summary", { jobId });

export const generateSummary = (jobId: string, prompt: string, model: string) =>
  invoke<void>("generate_summary", { jobId, prompt, model });

// Correction
export const correctTranscript = (jobId: string, model: string, instruction: string) =>
  invoke<void>("correct_transcript", { jobId, model, instruction });

// Recording
export interface WindowInfo {
  id: number;
  title: string;
  app: string;
}

export const listWindows = () =>
  invoke<void>("list_windows");

export const startRecording = (
  projectId: string,
  windowId: number,
  windowTitle: string,
  whisperModel: string,
) => invoke<string>("start_recording", { projectId, windowId, windowTitle, whisperModel });

export const stopRecording = (id: string) =>
  invoke<void>("stop_recording", { id });

export const captureWindowScreenshot = (windowId: number) =>
  invoke<void>("capture_window_screenshot", { windowId });

// Chat
export interface ChatMessage { role: "user" | "assistant"; content: string; }

export const chatWithTranscript = (jobId: string, model: string, messages: ChatMessage[]) =>
  invoke<void>("chat_with_transcript", { jobId, model, messages });
