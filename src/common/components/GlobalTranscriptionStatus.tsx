import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useWorkerEvents } from "@/common/hooks/useWorkerEvents";

export function GlobalTranscriptionStatus() {
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());

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

  if (runningJobs.size === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-lg">
      <Loader2 className="h-3 w-3 animate-spin" />
      Transcribing{runningJobs.size > 1 ? ` (${runningJobs.size})` : ""}…
    </div>
  );
}
