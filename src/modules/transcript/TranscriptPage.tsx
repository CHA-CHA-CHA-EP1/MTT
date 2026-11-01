import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, PanelRightClose, PanelRightOpen, Captions, CaptionsOff, Pencil, ScrollText, Copy, Check, Sparkles, Wand2, MessageSquare } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useTranscriptStore } from "./transcriptStore";
import { useWorkerEvents } from "@/common/hooks/useWorkerEvents";
import { ThemeToggle } from "@/common/components/ThemeToggle";
import { Player } from "./Player";
import { cn, formatDuration } from "@/lib/utils";
import { getJob, getAiConfig, updateSegment } from "@/lib/tauri";
import { SummaryPanel } from "@/modules/summary/SummaryPanel";
import { CorrectionPanel } from "@/modules/correction/CorrectionPanel";
import { ChatPanel } from "@/modules/chat/ChatPanel";

const MIN_PCT = 20;
const MAX_PCT = 80;
const CC_SIZES = [
  { label: "S", cls: "text-xs" },
  { label: "M", cls: "text-sm" },
  { label: "L", cls: "text-base" },
] as const;

export function TranscriptPage() {
  const { projectId, jobId } = useParams<{ projectId: string; jobId: string }>();
  const navigate = useNavigate();
  const { segments, loading, load, reload, setCurrentTime, activeSegmentIdx } =
    useTranscriptStore();

  const activeRef = useRef<HTMLLIElement>(null);
  const seekRef = useRef<(time: number) => void>(() => {});
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const ccMenuRef = useRef<HTMLDivElement>(null);

  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [title, setTitle] = useState("Transcript");
  const [splitPct, setSplitPct] = useState(50);
  const [panelOpen, setPanelOpen] = useState(true);
  const [ccEnabled, setCcEnabled] = useState(false);
  const [ccSizeIdx, setCcSizeIdx] = useState(1);
  const [ccMenuOpen, setCcMenuOpen] = useState(false);
  const [editingSegId, setEditingSegId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [fullView, setFullView] = useState(false);
  const [copied, setCopied] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [hasAiConfig, setHasAiConfig] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    load(jobId);
    getJob(jobId).then((job) => {
      setVideoSrc(convertFileSrc(job.file_path));
      setTitle(job.file_path.split("/").pop() ?? "Transcript");
    });
    getAiConfig().then((cfg) => setHasAiConfig(!!cfg?.api_key));
  }, [jobId]);

  useWorkerEvents({
    onChunk: ({ id }) => { if (id === jobId) reload(); },
  });

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeSegmentIdx()]);

  const handleSeekReady = useCallback((seek: (time: number) => void) => {
    seekRef.current = seek;
  }, []);

  const startEdit = (seg: { id: number; corrected_text?: string | null; text: string }) => {
    setEditingSegId(seg.id);
    setEditText(seg.corrected_text ?? seg.text);
  };

  const saveEdit = async (segId: number) => {
    await updateSegment(segId, editText.trim() || null);
    setEditingSegId(null);
    reload();
  };

  const cancelEdit = () => setEditingSegId(null);

  const fullText = segments
    .map((s) => s.corrected_text ?? s.text)
    .join(" ");

  const handleCopy = () => {
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.min(MAX_PCT, Math.max(MIN_PCT, pct)));
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Close CC menu when clicking outside
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ccMenuRef.current && !ccMenuRef.current.contains(e.target as Node))
        setCcMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const activeIdx = activeSegmentIdx();
  const activeSegment = segments[activeIdx];
  const ccText = ccEnabled && activeSegment
    ? (activeSegment.corrected_text ?? activeSegment.text)
    : null;

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/projects/${projectId}`)}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-xs text-muted-foreground/50">/</span>
          <h1 className="max-w-xs truncate text-sm font-medium" title={title}>{title}</h1>
        </div>
        <div className="flex items-center gap-1">
          {/* CC config */}
          <div ref={ccMenuRef} className="relative">
            <button
              onClick={() => {
                if (!ccEnabled) { setCcEnabled(true); setCcMenuOpen(true); }
                else setCcMenuOpen((v) => !v);
              }}
              title={ccEnabled ? "CC settings" : "Enable CC"}
              className={cn(
                "rounded p-1.5 transition-colors",
                ccEnabled
                  ? "text-foreground hover:bg-accent"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {ccEnabled
                ? <Captions className="h-4 w-4" />
                : <CaptionsOff className="h-4 w-4" />}
            </button>

            {ccMenuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border bg-popover p-3 shadow-lg">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-medium">Closed Captions</span>
                  <button
                    onClick={() => { setCcEnabled(false); setCcMenuOpen(false); }}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Turn off
                  </button>
                </div>
                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">Font size</p>
                  <div className="flex gap-1">
                    {CC_SIZES.map((s, i) => (
                      <button
                        key={s.label}
                        onClick={() => setCcSizeIdx(i)}
                        className={cn(
                          "flex-1 rounded py-1 text-xs font-medium transition-colors",
                          ccSizeIdx === i
                            ? "bg-foreground text-background"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => { setSummaryOpen((v) => !v); setCorrectionOpen(false); setChatOpen(false); }}
            disabled={!hasAiConfig}
            title={hasAiConfig ? "AI Summary" : "Set up AI in Settings first"}
            className={cn(
              "rounded p-1.5 transition-colors",
              summaryOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              !hasAiConfig && "opacity-30 cursor-not-allowed"
            )}
          >
            <Sparkles className="h-4 w-4" />
          </button>

          <button
            onClick={() => { setChatOpen((v) => !v); setSummaryOpen(false); setCorrectionOpen(false); }}
            disabled={!hasAiConfig}
            title={hasAiConfig ? "Chat with transcript" : "Set up AI in Settings first"}
            className={cn(
              "rounded p-1.5 transition-colors",
              chatOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              !hasAiConfig && "opacity-30 cursor-not-allowed"
            )}
          >
            <MessageSquare className="h-4 w-4" />
          </button>

          <button
            onClick={() => { setCorrectionOpen((v) => !v); setSummaryOpen(false); setChatOpen(false); }}
            disabled={!hasAiConfig}
            title={hasAiConfig ? "AI Correction" : "Set up AI in Settings first"}
            className={cn(
              "rounded p-1.5 transition-colors",
              correctionOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              !hasAiConfig && "opacity-30 cursor-not-allowed"
            )}
          >
            <Wand2 className="h-4 w-4" />
          </button>

          <button
            onClick={() => setPanelOpen((v) => !v)}
            title={panelOpen ? "Hide transcript" : "Show transcript"}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            {panelOpen
              ? <PanelRightClose className="h-4 w-4" />
              : <PanelRightOpen className="h-4 w-4" />}
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div ref={containerRef} className="flex flex-1 overflow-hidden select-none">
        {/* Video panel */}
        <div
          className="relative flex flex-col"
          style={{ width: panelOpen ? `${splitPct}%` : "100%" }}
        >
          <Player src={videoSrc} onTimeUpdate={setCurrentTime} onSeek={handleSeekReady} />

          {ccText && (
            <div className="absolute bottom-20 left-0 right-0 flex justify-center px-6 pointer-events-none">
              <div className={cn(
                "max-w-lg rounded-md bg-black/70 px-3 py-1.5 text-center leading-snug text-white backdrop-blur-sm",
                CC_SIZES[ccSizeIdx].cls
              )}>
                {ccText}
              </div>
            </div>
          )}
        </div>

        {/* Drag handle */}
        {panelOpen && (
          <div
            onMouseDown={() => { draggingRef.current = true; }}
            className="group relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-border hover:bg-primary/40 active:bg-primary/60 transition-colors"
          >
            <div className="h-8 w-0.5 rounded-full bg-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        )}

        {/* Transcript panel */}
        {panelOpen && (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <p className="text-xs text-muted-foreground">{segments.length} segments</p>
              <div className="flex items-center gap-1">
                {fullView && (
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                )}
                <button
                  onClick={() => setFullView((v) => !v)}
                  title={fullView ? "Show segments" : "View full transcript"}
                  className={cn("rounded p-1 transition-colors", fullView ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  <ScrollText className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : fullView ? (
              <div className="flex-1 overflow-y-auto px-5 py-4 select-text">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{fullText}</p>
              </div>
            ) : (
              <ul className="flex-1 overflow-y-auto p-3 space-y-0.5">
                {segments.map((seg, i) => {
                  const isActive = i === activeIdx;
                  const displayText = seg.corrected_text ?? seg.text;
                  return (
                    <li
                      key={seg.id}
                      ref={isActive ? activeRef : null}
                      className={cn(
                        "group flex gap-3 rounded-lg px-3 py-2 transition-colors",
                        editingSegId === seg.id ? "bg-accent" : isActive ? "bg-primary/10" : "hover:bg-accent",
                        seg.suspect && !seg.corrected_text && "opacity-50"
                      )}
                    >
                      <span
                        className="mt-0.5 shrink-0 cursor-pointer text-xs tabular-nums text-muted-foreground"
                        onClick={() => seekRef.current(seg.start)}
                      >
                        {formatDuration(seg.start)}
                      </span>

                      {editingSegId === seg.id ? (
                        <div className="flex flex-1 flex-col gap-1.5">
                          <textarea
                            autoFocus
                            value={editText}
                            onChange={(e) => {
                              setEditText(e.target.value);
                              e.target.style.height = "auto";
                              e.target.style.height = e.target.scrollHeight + "px";
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(seg.id); }
                              if (e.key === "Escape") cancelEdit();
                            }}
                            ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                            rows={1}
                            className="w-full resize-none overflow-hidden rounded border bg-background px-2 py-1 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-foreground/30"
                          />
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => saveEdit(seg.id)}
                              className="rounded px-2 py-0.5 text-xs font-medium bg-foreground text-background hover:opacity-80"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-1 items-start justify-between gap-2">
                          <p
                            className="cursor-pointer text-sm leading-relaxed"
                            onClick={() => seekRef.current(seg.start)}
                          >
                            {displayText}
                          </p>
                          <button
                            onClick={() => startEdit(seg)}
                            className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Summary panel */}
        {summaryOpen && jobId && (
          <SummaryPanel jobId={jobId} onClose={() => setSummaryOpen(false)} />
        )}

        {/* Chat panel */}
        {chatOpen && jobId && (
          <ChatPanel jobId={jobId} onClose={() => setChatOpen(false)} />
        )}

        {/* Correction panel */}
        {correctionOpen && jobId && (
          <CorrectionPanel
            jobId={jobId}
            onClose={() => setCorrectionOpen(false)}
            onDone={() => reload()}
          />
        )}
      </div>
    </div>
  );
}
