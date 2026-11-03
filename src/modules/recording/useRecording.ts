import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { startRecording, stopRecording, type WindowInfo, type MicOptions } from "@/lib/tauri";
import { useWhisperStore } from "@/lib/whisperConfig";

interface RecordingState {
  jobId: string | null;
  elapsed: number;
}

export function useRecording(projectId: string | undefined, onJobCreated: (jobId: string) => void) {
  const [state, setState] = useState<RecordingState>({ jobId: null, elapsed: 0 });
  const whisperModel = useWhisperStore((s) => s.model);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref tracks current jobId so stop() never reads a stale closure value.
  const jobIdRef = useRef<string | null>(null);

  useEffect(() => {
    jobIdRef.current = state.jobId;
  }, [state.jobId]);

  // Listen for recorder:stopped to clear recording state
  useEffect(() => {
    const unlisten = listen<{ id: string }>("recorder:stopped", (ev) => {
      setState(s => s.jobId === ev.payload.id ? { jobId: null, elapsed: 0 } : s);
    });
    const unlistenErr = listen<{ id: string; message: string }>("recorder:error", (ev) => {
      setState(s => s.jobId === ev.payload.id ? { jobId: null, elapsed: 0 } : s);
    });
    return () => {
      unlisten.then(fn => fn());
      unlistenErr.then(fn => fn());
    };
  }, []);

  // Elapsed timer
  useEffect(() => {
    if (state.jobId) {
      intervalRef.current = setInterval(() => {
        setState(s => ({ ...s, elapsed: s.elapsed + 1 }));
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [state.jobId]);

  const start = async (window: WindowInfo, micOptions: MicOptions = { enabled: true, deviceLabel: "" }) => {
    if (!projectId) return;
    try {
      const jobId = await startRecording(projectId, window.id, window.title, whisperModel, micOptions.enabled, micOptions.deviceLabel);
      setState({ jobId, elapsed: 0 });
      onJobCreated(jobId);
    } catch (e) {
      console.error("start recording failed:", e);
    }
  };

  const stop = async () => {
    const id = jobIdRef.current;
    if (!id) return;
    await stopRecording(id).catch(console.error);
  };

  return {
    isRecording: state.jobId !== null,
    recordingJobId: state.jobId,
    elapsed: state.elapsed,
    start,
    stop,
  };
}
