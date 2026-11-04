import { memo, forwardRef, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, PanelRightClose, PanelRightOpen, Captions, CaptionsOff, Pencil, ScrollText, Copy, Check, Sparkles, Wand2, MessageSquare, Search, X, Square, AlertCircle, RefreshCw, Mic, MicOff, Monitor, Play } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranscriptStore } from "./transcriptStore";
import { useWorkerEvents } from "@/common/hooks/useWorkerEvents";
import { ThemeToggle } from "@/common/components/ThemeToggle";
import { Player } from "./Player";
import { DVRPlayer, DVRChunk } from "./DVRPlayer";
import { cn, formatDuration } from "@/lib/utils";
import { getJob, getAiConfig, updateSegment, searchSegmentsInJob, stopRecording, cancelJob, retranscribeJob, toggleMic, Segment } from "@/lib/tauri";
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

// --- SegmentItem ---

interface SegmentItemProps {
  seg: Segment;
  isActive: boolean;
  isEditing: boolean;
  editText: string;
  isLiveRecording: boolean;
  onSeek: (time: number) => void;
  onStartEdit: (seg: Segment) => void;
  onSaveEdit: (id: number) => void;
  onCancelEdit: () => void;
  onEditTextChange: (text: string) => void;
}

const SegmentItem = memo(
  forwardRef<HTMLLIElement, SegmentItemProps>(
    ({ seg, isActive, isEditing, editText, isLiveRecording, onSeek, onStartEdit, onSaveEdit, onCancelEdit, onEditTextChange }, ref) => {
      const displayText = seg.corrected_text ?? seg.text;
      return (
        <li
          ref={ref}
          className={cn(
            "group flex gap-3 rounded-lg px-3 py-2 transition-colors",
            isEditing ? "bg-accent" : isActive ? "bg-primary/10" : "hover:bg-accent",
            seg.suspect && !seg.corrected_text && "opacity-50"
          )}
        >
          <span
            className="mt-0.5 shrink-0 cursor-pointer text-xs tabular-nums text-muted-foreground"
            onClick={() => onSeek(seg.start)}
          >
            {formatDuration(seg.start)}
          </span>

          {isEditing ? (
            <div className="flex flex-1 flex-col gap-1.5">
              <textarea
                autoFocus
                value={editText}
                onChange={(e) => {
                  onEditTextChange(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = e.target.scrollHeight + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSaveEdit(seg.id); }
                  if (e.key === "Escape") onCancelEdit();
                }}
                ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                rows={1}
                className="w-full resize-none overflow-hidden rounded border bg-background px-2 py-1 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-foreground/30"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={() => onSaveEdit(seg.id)}
                  className="rounded px-2 py-0.5 text-xs font-medium bg-foreground text-background hover:opacity-80"
                >
                  Save
                </button>
                <button
                  onClick={onCancelEdit}
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
                onClick={() => onSeek(seg.start)}
              >
                {displayText}
              </p>
              {!isLiveRecording && (
                <button
                  onClick={() => onStartEdit(seg)}
                  className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </li>
      );
    }
  ),
  (prev, next) =>
    prev.seg.id === next.seg.id &&
    prev.seg.text === next.seg.text &&
    prev.seg.corrected_text === next.seg.corrected_text &&
    prev.seg.suspect === next.seg.suspect &&
    prev.isActive === next.isActive &&
    prev.isEditing === next.isEditing &&
    prev.editText === next.editText &&
    prev.isLiveRecording === next.isLiveRecording
);

// --- TranscriptPage ---

interface TranscriptPageProps {
  jobId?: string;
  panelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
}

export function TranscriptPage({ jobId: jobIdProp, panelOpen: panelOpenProp, onPanelOpenChange }: TranscriptPageProps = {}) {
  const { projectId, jobId: jobIdParam } = useParams<{ projectId: string; jobId: string }>();
  const jobId = jobIdProp ?? jobIdParam;
  const navigate = useNavigate();
  const isEmbedded = !!jobIdProp;
  const { segments, loading, activeIdx, load, reload, appendNewSegments, clearSegments, setCurrentTime } = useTranscriptStore();

  const activeRef = useRef<HTMLLIElement>(null);
  const seekRef = useRef<(time: number) => void>(() => {});
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const ccMenuRef = useRef<HTMLDivElement>(null);

  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [title, setTitle] = useState("Transcript");
  const [isLiveRecording, setIsLiveRecording] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [micLevel, setMicLevel] = useState(0);
  const [systemLevel, setSystemLevel] = useState(0);
  const [isStopping, setIsStopping] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLevelRef = useRef(0);
  const [isRefining, setIsRefining] = useState(false);
  const [liveChunks, setLiveChunks] = useState<DVRChunk[]>([]);
  const [splitPct, setSplitPct] = useState(50);
  const [panelOpenLocal, setPanelOpenLocal] = useState(true);
  const panelOpen = panelOpenProp !== undefined ? panelOpenProp : panelOpenLocal;
  const setPanelOpen = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === "function" ? v(panelOpen) : v;
    setPanelOpenLocal(next);
    onPanelOpenChange?.(next);
  }, [panelOpen, onPanelOpenChange]);
  const [ccEnabled, setCcEnabled] = useState(false);
  const [ccSizeIdx, setCcSizeIdx] = useState(1);
  const [ccMenuOpen, setCcMenuOpen] = useState(false);
  const [editingSegId, setEditingSegId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [fullView, setFullView] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Segment[]>([]);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [hasAiConfig, setHasAiConfig] = useState(false);
  const [jobStatus, setJobStatus] = useState<string>("pending");
  const [jobErrorMessage, setJobErrorMessage] = useState<string | null>(null);
  const [retranscribeLang, setRetranscribeLang] = useState<"th" | "en" | "auto">("th");
  const [isRetranscribing, setIsRetranscribing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    load(jobId);
    getJob(jobId).then((job) => {
      setJobStatus(job.status);
      setJobErrorMessage(job.error_message ?? null);
      if (job.status === "recording") {
        setIsLiveRecording(true);
      } else if (job.status === "running") {
        setIsRefining(true);
        if (job.file_path) setVideoSrc(convertFileSrc(job.file_path));
      } else if (job.file_path) {
        setVideoSrc(convertFileSrc(job.file_path));
      }
      setTitle(job.title ?? job.recording_window ?? job.file_path.split("/").pop() ?? "Transcript");
    });
    getAiConfig().then((cfg) => setHasAiConfig(!!cfg?.api_key));
  }, [jobId]);

  // Recording elapsed timer
  useEffect(() => {
    if (isLiveRecording) {
      elapsedIntervalRef.current = setInterval(
        () => setRecordingElapsed((e) => e + 1),
        1000
      );
      setPanelOpen(false);
    } else {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
      setPanelOpen(true);
    }
    return () => { if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current); };
  }, [isLiveRecording]);

  // Listen for recording stopped → switch to video player
  useEffect(() => {
    if (!jobId) return;
    const unlisten = listen<{ id: string; file_path: string }>("recorder:stopped", (ev) => {
      if (ev.payload.id !== jobId) return;
      setIsLiveRecording(false);
      setIsStopping(false);
      setLiveChunks([]);
      setMicLevel(0);
      setSystemLevel(0);
      if (ev.payload.file_path) setVideoSrc(convertFileSrc(ev.payload.file_path));
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [jobId]);

  // Listen for audio level updates during live recording
  useEffect(() => {
    if (!jobId) return;
    const unlistenLevel = listen<{ id: string; system_level: number; mic_level: number }>(
      "recorder:audio_level",
      (ev) => {
        if (ev.payload.id !== jobId) return;
        const now = Date.now();
        if (now - lastLevelRef.current < 66) return; // throttle ~15Hz
        lastLevelRef.current = now;
        setSystemLevel(ev.payload.system_level);
        setMicLevel(ev.payload.mic_level);
      }
    );
    return () => { unlistenLevel.then((fn) => fn()); };
  }, [jobId]);

  // Collect chunk file paths during live recording for DVR playback
  useEffect(() => {
    if (!jobId) return;
    const unlisten = listen<{ id: string; index: number; path: string; offset: number }>("recorder:chunk_ready", (ev) => {
      if (ev.payload.id !== jobId) return;
      setLiveChunks((prev) => {
        const next = [...prev];
        next[ev.payload.index] = { path: convertFileSrc(ev.payload.path), offset: ev.payload.offset };
        return next;
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [jobId]);

  // Listen for Pass 2 starting → clear draft segments, show refining state
  useEffect(() => {
    if (!jobId) return;
    const unlisten = listen<{ id: string }>("recorder:refining", (ev) => {
      if (ev.payload.id !== jobId) return;
      setIsRefining(true);
      clearSegments();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [jobId]);

  useWorkerEvents({
    onChunk: ({ id }) => { if (id === jobId) appendNewSegments(); },
    onDone: ({ id }) => {
      if (id !== jobId) return;
      setIsRefining(false);
      setIsRetranscribing(false);
      setJobStatus("done");
    },
    onError: ({ id, message }) => {
      if (id !== jobId) return;
      setIsRefining(false);
      setIsRetranscribing(false);
      setJobStatus("error");
      setJobErrorMessage(message);
    },
    onCancelled: ({ id }) => {
      if (id !== jobId) return;
      setIsCancelling(false);
      setIsRetranscribing(false);
      setJobStatus("cancelled");
    },
  });

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeIdx]);

  const handleSeekReady = useCallback((seek: (time: number) => void) => {
    seekRef.current = seek;
  }, []);

  const handleSeek = useCallback((time: number) => seekRef.current(time), []);

  const startEdit = useCallback((seg: Segment) => {
    setEditingSegId(seg.id);
    setEditText(seg.corrected_text ?? seg.text);
  }, []);

  const saveEdit = useCallback(async (segId: number) => {
    await updateSegment(segId, editText.trim() || null);
    setEditingSegId(null);
    reload();
  }, [editText, reload]);

  const cancelEdit = useCallback(() => setEditingSegId(null), []);

  const handleStopRecording = useCallback(() => {
    if (jobId && !isStopping) {
      setIsStopping(true);
      stopRecording(jobId).catch(console.error);
    }
  }, [jobId, isStopping]);

  const handleToggleMic = useCallback(async () => {
    if (!jobId) return;
    const next = !micEnabled;
    setMicEnabled(next);
    await toggleMic(jobId, next).catch(console.error);
  }, [jobId, micEnabled]);

  const handleCancel = useCallback(() => {
    if (!jobId || isCancelling) return;
    setIsCancelling(true);
    cancelJob(jobId).catch(console.error);
  }, [jobId, isCancelling]);

  const handleRetranscribe = useCallback(async () => {
    if (!jobId || isRetranscribing) return;
    setIsRetranscribing(true);
    setJobStatus("running");
    setJobErrorMessage(null);
    clearSegments();
    setIsRefining(true);
    try {
      await retranscribeJob(jobId, retranscribeLang);
    } catch (e) {
      console.error(e);
      setIsRetranscribing(false);
      setIsRefining(false);
      setJobStatus("error");
    }
  }, [jobId, isRetranscribing, retranscribeLang, clearSegments]);

  useEffect(() => {
    if (!searchQuery.trim() || !jobId) { setSearchResults([]); return; }
    const t = setTimeout(() => {
      searchSegmentsInJob(jobId, searchQuery.trim()).then(setSearchResults).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, jobId]);

  const fullText = useMemo(
    () => segments.map((s) => s.corrected_text ?? s.text).join(" "),
    [segments]
  );

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

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ccMenuRef.current && !ccMenuRef.current.contains(e.target as Node))
        setCcMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const activeSegment = segments[activeIdx];
  const ccText = ccEnabled && activeSegment
    ? (activeSegment.corrected_text ?? activeSegment.text)
    : null;

  return (
    <div className={cn("flex flex-col bg-background", isEmbedded ? "flex-1 min-w-0 h-full" : "h-screen")}>
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          {!isEmbedded && (
            <>
              <button
                onClick={() => navigate(`/projects/${projectId}`)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted-foreground/50">/</span>
            </>
          )}
          <div className="flex items-center gap-2">
            {isLiveRecording && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
            )}
            <h1 className="max-w-xs truncate text-sm font-medium" title={title}>{title}</h1>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!isEmbedded && isLiveRecording && (
            <button
              onClick={handleStopRecording}
              disabled={isStopping}
              className="flex items-center gap-1.5 rounded-lg border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
            >
              {isStopping
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Square className="h-3.5 w-3.5 fill-current" />}
              {isStopping ? "Stopping..." : `Stop ${formatDuration(recordingElapsed)}`}
            </button>
          )}
          {jobStatus === "running" && !isLiveRecording && (
            <button
              onClick={handleCancel}
              disabled={isCancelling}
              className="flex items-center gap-1.5 rounded-lg border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
            >
              {isCancelling
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <X className="h-3.5 w-3.5" />}
              {isCancelling ? "Cancelling..." : "Cancel"}
            </button>
          )}
          {(jobStatus === "pending" || jobStatus === "error" || jobStatus === "cancelled" || jobStatus === "done") && !isLiveRecording && (
            <div className="flex items-center gap-1">
              <select
                value={retranscribeLang}
                onChange={(e) => setRetranscribeLang(e.target.value as "th" | "en" | "auto")}
                className="rounded border bg-background px-1.5 py-1 text-xs text-muted-foreground focus:outline-none"
              >
                <option value="th">Thai</option>
                <option value="en">English</option>
                <option value="auto">Auto</option>
              </select>
              <button
                onClick={handleRetranscribe}
                disabled={isRetranscribing}
                className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
              >
                {isRetranscribing
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : jobStatus === "pending"
                    ? <Play className="h-3.5 w-3.5" />
                    : <RefreshCw className="h-3.5 w-3.5" />}
                {isRetranscribing ? "Transcribing..." : jobStatus === "pending" ? "Transcribe" : "Re-transcribe"}
              </button>
            </div>
          )}
          {/* CC config */}
          <div ref={ccMenuRef} className="relative">
            <button
              onClick={() => {
                if (!ccEnabled) { setCcEnabled(true); setCcMenuOpen(true); }
                else setCcMenuOpen((v) => !v);
              }}
              title={ccEnabled ? "CC settings" : "Enable CC"}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1.5 text-xs transition-colors",
                ccEnabled
                  ? "text-foreground hover:bg-accent"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {ccEnabled
                ? <Captions className="h-3.5 w-3.5" />
                : <CaptionsOff className="h-3.5 w-3.5" />}
              <span>CC</span>
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
            disabled={!hasAiConfig || isLiveRecording}
            title={isLiveRecording ? "AI features unavailable during recording" : hasAiConfig ? "AI Summary" : "Set up AI in Settings first"}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1.5 text-xs transition-colors",
              summaryOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              !hasAiConfig && "opacity-30 cursor-not-allowed"
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Summarize</span>
          </button>

          <button
            onClick={() => { setChatOpen((v) => !v); setSummaryOpen(false); setCorrectionOpen(false); }}
            disabled={!hasAiConfig || isLiveRecording}
            title={isLiveRecording ? "AI features unavailable during recording" : hasAiConfig ? "Chat with transcript" : "Set up AI in Settings first"}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1.5 text-xs transition-colors",
              chatOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              !hasAiConfig && "opacity-30 cursor-not-allowed"
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>Chat</span>
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
          {!isEmbedded && <ThemeToggle />}
        </div>
      </header>

      <div ref={containerRef} className="flex flex-1 overflow-hidden select-none">
        {/* Video / Recording panel */}
        <div
          className="relative flex flex-col"
          style={{ width: panelOpen ? `${splitPct}%` : "100%" }}
        >
          {isLiveRecording && liveChunks.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 bg-black text-white">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                </span>
                <span className="text-base font-medium">Recording</span>
                <span className="tabular-nums text-base text-white/70">{formatDuration(recordingElapsed)}</span>
              </div>
              <p className="max-w-xs truncate text-sm text-white/50">{title}</p>
              <button
                onClick={handleStopRecording}
                disabled={isStopping}
                className="flex items-center gap-2 rounded-lg border border-white/20 px-5 py-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                {isStopping
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Square className="h-4 w-4 fill-current" />}
                {isStopping ? "Stopping..." : "Stop Recording"}
              </button>
              {/* Audio level monitor */}
              <div className="mt-4 flex flex-col gap-2 w-48">
                {/* Mic */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleMic}
                    className={cn("rounded p-1 transition-colors", micEnabled ? "text-white/80 hover:text-white" : "text-white/30 hover:text-white/50")}
                  >
                    {micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                  </button>
                  <div className="flex h-2 flex-1 items-center gap-px">
                    {Array.from({ length: 16 }, (_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex-1 rounded-full transition-all duration-75",
                          micEnabled && micLevel * 16 > i ? "bg-green-400" : "bg-white/20"
                        )}
                        style={{ height: micEnabled && micLevel * 16 > i ? "100%" : "35%" }}
                      />
                    ))}
                  </div>
                </div>
                {/* System audio */}
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-white/50" />
                  <div className="flex h-2 flex-1 items-center gap-px">
                    {Array.from({ length: 16 }, (_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex-1 rounded-full transition-all duration-75",
                          systemLevel * 16 > i ? "bg-blue-400" : "bg-white/20"
                        )}
                        style={{ height: systemLevel * 16 > i ? "100%" : "35%" }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative flex min-h-0 flex-1 flex-col">
              {isLiveRecording ? (
                <DVRPlayer
                  chunks={liveChunks}
                  chunkDuration={30}
                  onTimeUpdate={setCurrentTime}
                  onSeek={handleSeekReady}
                />
              ) : (
                <Player
                  src={videoSrc}
                  onTimeUpdate={setCurrentTime}
                  onSeek={handleSeekReady}
                />
              )}
              {isLiveRecording && (
                <div className="absolute left-3 top-3 flex flex-col gap-1.5 rounded-xl bg-black/70 px-3 py-2 backdrop-blur-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                    </span>
                    <span className="text-xs font-medium text-white">REC {formatDuration(recordingElapsed)}</span>
                  </div>
                  {/* Mic row */}
                  <div className="flex items-center gap-1.5">
                    <button onClick={handleToggleMic} className="text-white/70 hover:text-white">
                      {micEnabled
                        ? <Mic className="h-3 w-3" />
                        : <MicOff className="h-3 w-3 text-white/30" />}
                    </button>
                    <div className="flex h-1.5 w-20 items-center gap-0.5">
                      {Array.from({ length: 12 }, (_, i) => (
                        <div
                          key={i}
                          className={cn(
                            "flex-1 rounded-full transition-all duration-75",
                            micEnabled && micLevel * 12 > i ? "bg-green-400" : "bg-white/20"
                          )}
                          style={{ height: micEnabled && micLevel * 12 > i ? "100%" : "40%" }}
                        />
                      ))}
                    </div>
                  </div>
                  {/* System audio row */}
                  <div className="flex items-center gap-1.5">
                    <Monitor className="h-3 w-3 text-white/70" />
                    <div className="flex h-1.5 w-20 items-center gap-0.5">
                      {Array.from({ length: 12 }, (_, i) => (
                        <div
                          key={i}
                          className={cn(
                            "flex-1 rounded-full transition-all duration-75",
                            systemLevel * 12 > i ? "bg-blue-400" : "bg-white/20"
                          )}
                          style={{ height: systemLevel * 12 > i ? "100%" : "40%" }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {!isLiveRecording && ccText && (
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
              {!isLiveRecording && (
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
                    onClick={() => { setCorrectionOpen((v) => !v); setSummaryOpen(false); setChatOpen(false); }}
                    disabled={!hasAiConfig}
                    title={hasAiConfig ? "AI Correction" : "Set up AI in Settings first"}
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
                      correctionOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                      !hasAiConfig && "opacity-30 cursor-not-allowed"
                    )}
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    <span>Improve text</span>
                  </button>
                  <button
                    onClick={() => { setSearchOpen((v) => !v); setSearchQuery(""); setSearchResults([]); }}
                    title="Search transcript"
                    className={cn("rounded p-1 transition-colors", searchOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setFullView((v) => !v)}
                    title={fullView ? "Show segments" : "View full transcript"}
                    className={cn("rounded p-1 transition-colors", fullView ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    <ScrollText className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Search bar */}
            {searchOpen && (
              <div className="border-b px-3 py-2">
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-1.5">
                  <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <input
                    autoFocus
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search segments..."
                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  />
                  {searchQuery && (
                    <button onClick={() => { setSearchQuery(""); setSearchResults([]); }} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {searchQuery && (
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
            )}

            {loading ? (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : isRefining ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Improving transcript quality...</p>
              </div>
            ) : jobStatus === "error" ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
                <AlertCircle className="h-8 w-8 text-destructive/70" />
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium text-destructive">Transcription failed</p>
                  {jobErrorMessage && (
                    <p className="max-w-sm text-xs text-muted-foreground break-all">{jobErrorMessage}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={retranscribeLang}
                    onChange={(e) => setRetranscribeLang(e.target.value as "th" | "en" | "auto")}
                    className="rounded border bg-background px-2 py-1.5 text-xs text-muted-foreground focus:outline-none"
                  >
                    <option value="th">Thai</option>
                    <option value="en">English</option>
                    <option value="auto">Auto</option>
                  </select>
                  <button
                    onClick={handleRetranscribe}
                    disabled={isRetranscribing}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    {isRetranscribing
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <RefreshCw className="h-3.5 w-3.5" />}
                    {isRetranscribing ? "Transcribing..." : "Try again"}
                  </button>
                </div>
              </div>
            ) : fullView ? (
              <div className="flex-1 overflow-y-auto px-5 py-4 select-text">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{fullText}</p>
              </div>
            ) : searchOpen && searchQuery ? (
              <ul className="flex-1 overflow-y-auto p-3 space-y-0.5">
                {searchResults.length === 0 ? (
                  <li className="flex h-20 items-center justify-center text-xs text-muted-foreground">No results</li>
                ) : searchResults.map((seg) => (
                  <li
                    key={seg.id}
                    onClick={() => handleSeek(seg.start)}
                    className="flex cursor-pointer gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-accent"
                  >
                    <span className="mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(seg.start)}</span>
                    <span className="text-xs leading-relaxed">{seg.corrected_text ?? seg.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="flex-1 overflow-y-auto p-3 space-y-0.5">
                {segments.map((seg, i) => (
                  <SegmentItem
                    key={seg.id}
                    ref={i === activeIdx ? activeRef : null}
                    seg={seg}
                    isActive={i === activeIdx}
                    isEditing={editingSegId === seg.id}
                    editText={editingSegId === seg.id ? editText : ""}
                    isLiveRecording={isLiveRecording}
                    onSeek={handleSeek}
                    onStartEdit={startEdit}
                    onSaveEdit={saveEdit}
                    onCancelEdit={cancelEdit}
                    onEditTextChange={setEditText}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {summaryOpen && jobId && (
          <SummaryPanel jobId={jobId} onClose={() => setSummaryOpen(false)} />
        )}
        {chatOpen && jobId && (
          <ChatPanel jobId={jobId} onClose={() => setChatOpen(false)} />
        )}
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
