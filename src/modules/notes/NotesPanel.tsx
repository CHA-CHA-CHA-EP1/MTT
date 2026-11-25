import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Copy, Check } from "lucide-react";
import { getJobNotes, saveJobNotes } from "@/lib/tauri";
import { TimestampNode, TimestampContext } from "./TimestampNode";
import { createSlashCommand } from "./SlashCommand";

// Minimal markdown serializer for the content types we use
function toMarkdown(html: string): string {
  return html
    .replace(/<h1>(.*?)<\/h1>/g, "# $1")
    .replace(/<h2>(.*?)<\/h2>/g, "## $1")
    .replace(/<h3>(.*?)<\/h3>/g, "### $1")
    .replace(/<strong>(.*?)<\/strong>/g, "**$1**")
    .replace(/<em>(.*?)<\/em>/g, "_$1_")
    .replace(/<code>(.*?)<\/code>/g, "`$1`")
    .replace(/<blockquote>(.*?)<\/blockquote>/gs, (_, inner) =>
      inner.trim().split("\n").map((l: string) => `> ${l}`).join("\n")
    )
    .replace(/<li data-type="taskItem" data-checked="true">(.*?)<\/li>/gs, "- [x] $1")
    .replace(/<li data-type="taskItem" data-checked="false">(.*?)<\/li>/gs, "- [ ] $1")
    .replace(/<li>(.*?)<\/li>/gs, "- $1")
    .replace(/<ul>|<\/ul>|<ol>|<\/ol>|<ul[^>]*>|<\/ul>/g, "")
    .replace(/<p>(.*?)<\/p>/gs, "$1")
    .replace(/<hr>/g, "---")
    .replace(/data-type="timestamp"[^>]*data-time="([^"]+)"[^>]*>[^<]*<\/span>/g, "⏱ $1s")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MIN_WIDTH = 240;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 320;

interface NotesPanelProps {
  jobId: string;
  currentTimeRef?: React.RefObject<number>;
  isLiveRecording?: boolean;
  onSeek?: (time: number) => void;
}

export function NotesPanel({
  jobId,
  currentTimeRef,
  isLiveRecording = false,
  onSeek,
}: NotesPanelProps) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartX = useRef<number | null>(null);
  const dragStartWidth = useRef<number>(DEFAULT_WIDTH);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = width;

    const onMouseMove = (ev: MouseEvent) => {
      if (dragStartX.current == null) return;
      const delta = dragStartX.current - ev.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta)));
    };
    const onMouseUp = () => {
      dragStartX.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [width]);

  const slashCommand = useMemo(
    () => createSlashCommand(() => currentTimeRef?.current ?? 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: {},
        codeBlock: {},
        blockquote: {},
        horizontalRule: {},
        bulletList: {},
        orderedList: {},
      }),
      Placeholder.configure({
        placeholder: "Start typing your notes… type /ts to stamp the current time",
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TimestampNode,
      slashCommand,
    ],
    editorProps: {
      attributes: {
        class: "tiptap focus:outline-none min-h-full px-5 py-4 leading-relaxed [font-family:'Sarabun',sans-serif] text-[15px]",
      },
    },
    onUpdate: ({ editor }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      setSaveState("saving");
      saveTimer.current = setTimeout(async () => {
        try {
          await saveJobNotes(jobId, editor.getHTML());
          setSaveState("saved");
          savedTimer.current = setTimeout(() => setSaveState("idle"), 2000);
        } catch {
          setSaveState("idle");
        }
      }, 800);
    },
  });

  // Load existing notes
  useEffect(() => {
    if (!editor) return;
    getJobNotes(jobId).then((notes) => {
      if (notes) editor.commands.setContent(notes, { emitUpdate: false });
    });
  }, [jobId, editor]);

  // Cleanup timers on unmount
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const handleCopyMarkdown = useCallback(async () => {
    if (!editor) return;
    const md = toMarkdown(editor.getHTML());
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [editor]);

  const timestampCtx = useMemo(
    () => ({ isLiveRecording, onSeek }),
    [isLiveRecording, onSeek],
  );

  return (
    <TimestampContext.Provider value={timestampCtx}>
      <div className="relative flex h-full shrink-0 flex-col border-l bg-background" style={{ width }}>
        {/* Resize handle */}
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
        />
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">Notes</span>
          <div className="flex items-center gap-2">
            {saveState === "saving" && (
              <span className="text-[10px] text-muted-foreground/60">Saving…</span>
            )}
            {saveState === "saved" && (
              <span className="text-[10px] text-green-500">Saved</span>
            )}
            <button
              onClick={handleCopyMarkdown}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Copy as Markdown"
            >
              {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied!" : "Copy MD"}
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-y-auto">
          <EditorContent editor={editor} className="h-full" />
        </div>
      </div>
    </TimestampContext.Provider>
  );
}
