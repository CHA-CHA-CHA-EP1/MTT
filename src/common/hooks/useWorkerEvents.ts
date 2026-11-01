import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

interface WorkerChunkEvent {
  id: string;
  index: number;
}

interface WorkerCorrectionEvent {
  id: string;
  start_idx: number;
}

interface WorkerDoneEvent {
  id: string;
}

interface WorkerErrorEvent {
  id: string;
  message: string;
}

interface WorkerCancelledEvent {
  id: string;
}

interface Handlers {
  onReady?: () => void;
  onChunk?: (e: WorkerChunkEvent) => void;
  onCorrection?: (e: WorkerCorrectionEvent) => void;
  onDone?: (e: WorkerDoneEvent) => void;
  onError?: (e: WorkerErrorEvent) => void;
  onCancelled?: (e: WorkerCancelledEvent) => void;
}

export function useWorkerEvents(handlers: Handlers) {
  useEffect(() => {
    const unlisten = Promise.all([
      handlers.onReady ? listen("worker:ready", () => handlers.onReady!()) : null,
      handlers.onChunk ? listen<WorkerChunkEvent>("worker:chunk", (e) => handlers.onChunk!(e.payload)) : null,
      handlers.onCorrection ? listen<WorkerCorrectionEvent>("worker:correction", (e) => handlers.onCorrection!(e.payload)) : null,
      handlers.onDone ? listen<WorkerDoneEvent>("worker:done", (e) => handlers.onDone!(e.payload)) : null,
      handlers.onError ? listen<WorkerErrorEvent>("worker:error", (e) => handlers.onError!(e.payload)) : null,
      handlers.onCancelled ? listen<WorkerCancelledEvent>("worker:cancelled", (e) => handlers.onCancelled!(e.payload)) : null,
    ]);

    return () => {
      unlisten.then((fns) => fns.forEach((fn) => fn?.()));
    };
  }, []);
}
