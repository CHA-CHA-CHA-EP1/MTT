import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useWorkerEvents } from "@/common/hooks/useWorkerEvents";

export function GlobalTranscriptionStatus() {
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());
  const [recovering, setRecovering] = useState<{ current: number; total: number } | null>(null);

  useWorkerEvents({
    onChunk: ({ id }) =>
      setRunningJobs((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      }),
    onDone: ({ id }) =>
      setRunningJobs((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    onError: ({ id }) =>
      setRunningJobs((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    onCancelled: ({ id }) =>
      setRunningJobs((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
  });

  useEffect(() => {
    const unlistenStart = listen<number>("recovery:start", (e) =>
      setRecovering({ current: 0, total: e.payload })
    );
    const unlistenProgress = listen<{ current: number; total: number }>("recovery:progress", (e) =>
      setRecovering(e.payload)
    );
    const unlistenDone = listen("recovery:done", () => setRecovering(null));
    return () => {
      unlistenStart.then((fn) => fn());
      unlistenProgress.then((fn) => fn());
      unlistenDone.then((fn) => fn());
    };
  }, []);

  if (runningJobs.size === 0 && !recovering) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-1.5">
      {recovering && (
        <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-lg">
          <Loader2 className="h-3 w-3 animate-spin" />
          Recovering recordings ({recovering.current}/{recovering.total})…
        </div>
      )}
      {runningJobs.size > 0 && (
        <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-lg">
          <Loader2 className="h-3 w-3 animate-spin" />
          Transcribing{runningJobs.size > 1 ? ` (${runningJobs.size})` : ""}…
        </div>
      )}
    </div>
  );
}
