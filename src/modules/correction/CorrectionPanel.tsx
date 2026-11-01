import { useEffect, useState } from "react";
import { X, Wand2 } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { correctTranscript, getAiConfig, listAiModels, getSummaryConfig } from "@/lib/tauri";

interface Props {
  jobId: string;
  onClose: () => void;
  onDone: () => void;
}

type View = "config" | "running" | "done";

export function CorrectionPanel({ jobId, onClose, onDone }: Props) {
  const [view, setView] = useState<View>("config");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [correctedCount, setCorrectedCount] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    getAiConfig().then((cfg) => {
      if (cfg) listAiModels(cfg).then(setModels).catch(() => {});
    });
    // Pre-fill model from summary config (same AI config)
    getSummaryConfig().then((cfg) => setModel(cfg.model));
  }, []);

  const handleRun = async () => {
    setError("");
    setProgress({ current: 0, total: 0 });
    setView("running");

    const unlisten = await listen<{ job_id: string; current: number; total: number }>(
      "correction:progress",
      (e) => { if (e.payload.job_id === jobId) setProgress(e.payload); }
    );
    const unlistenDone = await listen<{ job_id: string; corrected_count: number }>(
      "correction:done",
      (e) => {
        if (e.payload.job_id === jobId) {
          setCorrectedCount(e.payload.corrected_count);
          setView("done");
          unlisten();
          unlistenDone();
          onDone();
        }
      }
    );

    try {
      await correctTranscript(jobId, model, instruction);
    } catch (e: unknown) {
      const msg = typeof e === "object" && e !== null && "message" in e
        ? String((e as { message: unknown }).message) : String(e);
      setError(msg);
      setView("config");
      unlisten();
      unlistenDone();
    }
  };

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-l bg-background">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">AI Correction</span>
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {view === "config" && (
          <>
            <p className="text-xs text-muted-foreground leading-relaxed">
              AI will fix grammar, spelling, and proper nouns across all segments. Results are saved as corrected text.
            </p>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Model</label>
              {models.length > 0 ? (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-foreground/30"
                >
                  {model && !models.includes(model) && <option value={model}>{model}</option>}
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-foreground/30"
                />
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Additional instruction <span className="opacity-50">(optional)</span>
              </label>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                placeholder="e.g. This is a financial meeting, use formal terminology"
                className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-foreground/30"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
            )}

            <button
              onClick={handleRun}
              disabled={!model}
              className="flex items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-80 disabled:opacity-40"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Run Correction
            </button>
          </>
        )}

        {view === "running" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <Wand2 className="h-8 w-8 animate-pulse text-muted-foreground" />
            <div className="w-full text-center">
              <p className="mb-2 text-xs font-medium">Correcting transcript...</p>
              {progress.total > 0 && (
                <>
                  <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-foreground transition-all"
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Batch {progress.current} / {progress.total}
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {view === "done" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
              <Wand2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm font-medium">Done!</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {correctedCount} segments corrected
              </p>
            </div>
            <button
              onClick={() => setView("config")}
              className="mt-2 rounded-lg border px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Run again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
