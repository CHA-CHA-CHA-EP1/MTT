import { create } from "zustand";
import { getWhisperModel, saveWhisperModel } from "./tauri";

export interface WhisperModel {
  id: string;
  label: string;
  description: string;
}

export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: "mlx-community/Qwen3-ASR-1.7B-bf16",
    label: "Qwen3 ASR 1.7B",
    description: "Recommended — best Thai/multilingual quality",
  },
  {
    id: "mlx-community/whisper-large-v3-turbo",
    label: "Whisper Large v3 Turbo",
    description: "Fast & accurate",
  },
  {
    id: "mlx-community/whisper-large-v3-mlx",
    label: "Whisper Large v3",
    description: "Best Whisper quality, slower",
  },
];

const DEFAULT_MODEL = WHISPER_MODELS[0].id;

interface WhisperStore {
  model: string;
  loaded: boolean;
  /** Load saved model from disk — call once on app startup */
  load: () => Promise<string>;
  /** Persist new model to disk (does NOT reload the worker) */
  save: (model: string) => Promise<void>;
}

export const useWhisperStore = create<WhisperStore>((set) => ({
  model: DEFAULT_MODEL,
  loaded: false,

  load: async () => {
    const saved = await getWhisperModel();
    // If the saved model is no longer in our list (e.g. removed or requires auth),
    // fall back to the default so startup doesn't fail.
    const valid = WHISPER_MODELS.some((m) => m.id === saved);
    const model = valid ? saved : DEFAULT_MODEL;
    if (!valid) await saveWhisperModel(model);
    set({ model, loaded: true });
    return model;
  },

  save: async (model: string) => {
    await saveWhisperModel(model);
    set({ model });
  },
}));
