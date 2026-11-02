import { useEffect, useRef, useState } from "react";
import { X, Sparkles, RotateCcw, Copy, Check } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  SummaryConfig,
  generateSummary,
  getAiConfig,
  getJobSummary,
  getSummaryConfig,
  listAiModels,
  saveSummaryConfig,
} from "@/lib/tauri";

interface Props {
  jobId: string;
  onClose: () => void;
}

type View = "config" | "generating" | "result";

const PROMPT_PRESETS = [
  {
    label: "General Summary",
    prompt: "Please summarize this meeting transcript. Include:\n1. Key discussion points\n2. Decisions made\n3. Action items with owners (if mentioned)\n\nBe concise and use the same language as the transcript.",
  },
  {
    label: "Action Items",
    prompt: "Extract all action items from this meeting transcript. For each item include:\n- Task description\n- Owner (if mentioned)\n- Deadline (if mentioned)\n- Priority (if mentioned)\n\nFormat as a clear checklist. Use the same language as the transcript.",
  },
];

export function SummaryPanel({ jobId, onClose }: Props) {
  const [view, setView] = useState<View>("config");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<Array<() => void>>([]);

  // Cleanup lingering listeners on unmount (e.g. panel closed while streaming)
  useEffect(() => () => { unlistenRef.current.forEach(f => f()); }, []);

  useEffect(() => {
    // Load summary config + existing summary + models in parallel
    getSummaryConfig().then((cfg) => {
      setPrompt(cfg.prompt);
      setModel(cfg.model);
    });
    getJobSummary(jobId).then((s) => {
      if (s) { setSummary(s); setView("result"); }
    });
    getAiConfig().then((cfg) => {
      if (cfg) listAiModels(cfg).then(setModels).catch(() => {});
    });
  }, [jobId]);

  // Auto-scroll while streaming
  useEffect(() => {
    if (view === "generating") {
      streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight });
    }
  }, [summary, view]);

  const handleGenerate = async () => {
    // Cancel any previous listeners before starting a new generation
    unlistenRef.current.forEach(f => f());
    unlistenRef.current = [];

    setError("");
    setSummary("");
    setView("generating");
    await saveSummaryConfig({ prompt, model } satisfies SummaryConfig);

    const unlisten = await listen<{ job_id: string; text: string }>("summary:chunk", (e) => {
      if (e.payload.job_id === jobId)
        setSummary((prev) => prev + e.payload.text);
    });
    const unlistenDone = await listen<{ job_id: string }>("summary:done", (e) => {
      if (e.payload.job_id === jobId) {
        setView("result");
        cleanup();
      }
    });

    const cleanup = () => {
      unlisten();
      unlistenDone();
      unlistenRef.current = unlistenRef.current.filter(f => f !== unlisten && f !== unlistenDone);
    };
    unlistenRef.current.push(unlisten, unlistenDone);

    try {
      await generateSummary(jobId, prompt, model);
    } catch (e: unknown) {
      const msg = typeof e === "object" && e !== null && "message" in e
        ? String((e as { message: unknown }).message) : String(e);
      setError(msg);
      setView("config");
      cleanup();
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">AI Summary</span>
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Config / Generating view */}
      {(view === "config" || view === "generating") && (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {/* Preset buttons */}
          <div className="flex gap-1">
            {PROMPT_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setPrompt(p.prompt)}
                disabled={view === "generating"}
                className="flex-1 rounded-lg border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              disabled={view === "generating"}
              className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-foreground/30 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Model</label>
            {models.length > 0 ? (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={view === "generating"}
                className="w-full rounded-lg border bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-foreground/30 disabled:opacity-50"
              >
                {model && !models.includes(model) && (
                  <option value={model}>{model}</option>
                )}
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={view === "generating"}
                className="w-full rounded-lg border bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-foreground/30 disabled:opacity-50"
              />
            )}
          </div>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          {view === "generating" ? (
            <div
              ref={streamRef}
              className="flex-1 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed"
            >
              {summary
                ? <span className="whitespace-pre-wrap text-muted-foreground">{summary}</span>
                : <span className="animate-pulse text-muted-foreground">Generating...</span>
              }
            </div>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={!prompt || !model}
              className="flex items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-80 disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Generate Summary
            </button>
          )}
        </div>
      )}

      {/* Result view */}
      {view === "result" && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4">
            <div className="prose prose-sm dark:prose-invert max-w-none text-xs
              [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:mb-2 [&_h1]:mt-3
              [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:mb-1.5 [&_h2]:mt-3
              [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2
              [&_ul]:pl-4 [&_ul]:space-y-0.5
              [&_ol]:pl-4 [&_ol]:space-y-0.5
              [&_li]:leading-relaxed
              [&_p]:mb-2 [&_p]:leading-relaxed
              [&_strong]:font-semibold">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
            </div>
          </div>
          <div className="flex items-center justify-between border-t px-4 py-2">
            <button
              onClick={() => setView("config")}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Regenerate
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
