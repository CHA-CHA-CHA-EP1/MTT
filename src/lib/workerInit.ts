import { listen } from "@tauri-apps/api/event";
import { initWorker } from "./tauri";

let readyPromise: Promise<void> | null = null;

/**
 * Lazily initializes the transcription worker the first time it's called.
 * Subsequent calls return the same promise — model loads only once per session.
 */
export function ensureWorkerReady(model: string): Promise<void> {
  if (!readyPromise) {
    readyPromise = new Promise<void>(async (resolve, reject) => {
      // Set up listener BEFORE sending init to avoid missing the event
      const unlisten = await listen("worker:ready", () => {
        unlisten();
        resolve();
      });
      try {
        await initWorker(model);
      } catch (e) {
        unlisten();
        readyPromise = null; // Allow retry on next call
        reject(e);
      }
    });
  }
  return readyPromise;
}
