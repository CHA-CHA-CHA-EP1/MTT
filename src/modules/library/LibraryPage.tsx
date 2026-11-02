import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileVideo, Plus, Loader2, CheckCircle, XCircle, Clock, Video, Square, Monitor } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useJobStore } from "./jobStore";
import { useWorkerEvents } from "@/common/hooks/useWorkerEvents";
import { ThemeToggle } from "@/common/components/ThemeToggle";
import { formatTimestamp, formatDuration } from "@/lib/utils";
import { WindowPickerModal } from "@/modules/recording/WindowPickerModal";
import { useRecording } from "@/modules/recording/useRecording";
import type { Job } from "@/lib/tauri";

const WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo";

const statusIcon: Record<Job["status"], React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
  done: <CheckCircle className="h-4 w-4 text-green-500" />,
  error: <XCircle className="h-4 w-4 text-destructive" />,
  cancelled: <XCircle className="h-4 w-4 text-muted-foreground" />,
  recording: <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" /></span>,
};

const statusLabel: Record<Job["status"], string> = {
  pending: "Pending",
  running: "Transcribing...",
  done: "Done",
  error: "Error",
  cancelled: "Cancelled",
  recording: "Recording...",
};

export function LibraryPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { jobs, loading, setActiveProject, create, cancel, remove, updateStatus } = useJobStore();
  const [showWindowPicker, setShowWindowPicker] = useState(false);

  useEffect(() => {
    if (projectId) setActiveProject(projectId);
  }, [projectId]);

  useWorkerEvents({
    onDone: ({ id }) => updateStatus(id, "done"),
    onError: ({ id }) => updateStatus(id, "error"),
    onCancelled: ({ id }) => updateStatus(id, "cancelled"),
    onChunk: ({ id }) => updateStatus(id, "running"),
  });

  // Update job card when recording stops
  useEffect(() => {
    const unlisten = listen<{ id: string }>("recorder:stopped", (ev) => {
      // Status transitions to "running" (Transcribing...) — Rust will emit worker:done
      // via worker:done once all remaining chunks finish transcribing
      updateStatus(ev.payload.id, "running");
    });
    const unlistenErr = listen<{ id: string; message: string }>("recorder:error", (ev) => {
      if (ev.payload.id) updateStatus(ev.payload.id, "error");
    });
    return () => {
      unlisten.then(fn => fn());
      unlistenErr.then(fn => fn());
    };
  }, []);

  const { isRecording, elapsed, start, stop } = useRecording(projectId, (jobId) => {
    navigate(`/projects/${projectId}/jobs/${jobId}`);
  });

  const handleAdd = async () => {
    const selected = await open({ multiple: false, filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "m4v", "avi"] }] });
    if (!selected || !projectId) return;
    await create(projectId, selected as string, WHISPER_MODEL);
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate("/")} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-xs text-muted-foreground/50">/</span>
          <h1 className="text-sm font-medium">Library</h1>
        </div>
        <div className="flex items-center gap-1">
          {isRecording ? (
            <button
              onClick={stop}
              className="flex items-center gap-1.5 rounded-lg border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Stop {formatDuration(elapsed)}
            </button>
          ) : (
            <button
              onClick={() => setShowWindowPicker(true)}
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Video className="h-3.5 w-3.5" />
              Record
            </button>
          )}
          <button
            onClick={handleAdd}
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Video
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
              <FileVideo className="h-10 w-10 opacity-40" />
              <p className="text-sm">No videos yet — add one to get started</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  className="group flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-accent"
                >
                  {job.recording_window
                    ? <Monitor className="h-5 w-5 shrink-0 text-muted-foreground" />
                    : <FileVideo className="h-5 w-5 shrink-0 text-muted-foreground" />}

                  <button
                    className="flex flex-1 flex-col items-start gap-0.5 text-left"
                    onClick={() => (job.status === "done" || job.status === "running") && navigate(`/projects/${projectId}/jobs/${job.id}`)}
                    disabled={job.status === "pending" || job.status === "error" || job.status === "cancelled" || job.status === "recording"}
                  >
                    <span className="text-sm font-medium leading-tight">
                      {job.recording_window ?? job.file_path.split("/").pop()}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatTimestamp(job.created_at)}</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {statusIcon[job.status]}
                      {statusLabel[job.status]}
                    </span>
                    {job.status === "recording" && (
                      <button
                        onClick={stop}
                        className="rounded px-2 py-0.5 text-xs text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                      >
                        Stop
                      </button>
                    )}
                    {job.status === "running" && (
                      <button
                        onClick={() => cancel(job.id)}
                        className="rounded px-2 py-0.5 text-xs text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                      >
                        Cancel
                      </button>
                    )}
                    {(job.status === "done" || job.status === "error" || job.status === "cancelled") && (
                      <button
                        onClick={() => remove(job.id)}
                        className="rounded px-2 py-0.5 text-xs text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {showWindowPicker && (
        <WindowPickerModal
          onSelect={async (win) => {
            setShowWindowPicker(false);
            await start(win);
          }}
          onClose={() => setShowWindowPicker(false)}
        />
      )}
    </div>
  );
}
