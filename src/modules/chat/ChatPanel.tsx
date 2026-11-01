import { useEffect, useRef, useState } from "react";
import { X, MessageSquare, Send } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessage, chatWithTranscript, getAiConfig, listAiModels, getSummaryConfig } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface Props {
  jobId: string;
  onClose: () => void;
}

export function ChatPanel({ jobId, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getAiConfig().then((cfg) => {
      if (cfg) listAiModels(cfg).then(setModels).catch(() => {});
    });
    getSummaryConfig().then((cfg) => setModel(cfg.model));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setError("");

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setStreaming(true);

    // Add empty assistant message to stream into
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const unlisten = await listen<{ job_id: string; text: string }>("chat:chunk", (e) => {
      if (e.payload.job_id === jobId) {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: updated[updated.length - 1].content + e.payload.text,
          };
          return updated;
        });
      }
    });

    const unlistenDone = await listen<{ job_id: string }>("chat:done", (e) => {
      if (e.payload.job_id === jobId) {
        setStreaming(false);
        unlisten();
        unlistenDone();
      }
    });

    try {
      await chatWithTranscript(jobId, model, newMessages);
    } catch (e: unknown) {
      const msg = typeof e === "object" && e !== null && "message" in e
        ? String((e as { message: unknown }).message) : String(e);
      setError(msg);
      setStreaming(false);
      // Remove empty assistant message on error
      setMessages((prev) => prev.slice(0, -1));
      unlisten();
      unlistenDone();
    }
  };

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Chat</span>
        </div>
        <div className="flex items-center gap-2">
          {models.length > 0 ? (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded border bg-background px-2 py-1 text-xs outline-none"
            >
              {model && !models.includes(model) && <option value={model}>{model}</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-32 rounded border bg-background px-2 py-1 text-xs outline-none"
            />
          )}
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">Ask anything about this transcript</p>
            <div className="mt-2 flex flex-col gap-1.5 w-full">
              {["Summarize the key decisions", "What action items were mentioned?", "Who said what about the budget?"].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); inputRef.current?.focus(); }}
                  className="rounded-lg border px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[85%] rounded-2xl px-3 py-2 text-xs",
              msg.role === "user"
                ? "bg-foreground text-background rounded-br-sm"
                : "bg-muted rounded-bl-sm"
            )}>
              {msg.role === "assistant" ? (
                <div className="prose prose-sm dark:prose-invert max-w-none text-xs
                  [&_p]:mb-1.5 [&_p]:leading-relaxed
                  [&_ul]:pl-3 [&_ul]:space-y-0.5
                  [&_ol]:pl-3 [&_ol]:space-y-0.5
                  [&_li]:leading-relaxed
                  [&_strong]:font-semibold">
                  {msg.content
                    ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    : <span className="animate-pulse text-muted-foreground">...</span>
                  }
                </div>
              ) : (
                <p className="leading-relaxed">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder="Ask about this transcript..."
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-foreground/30 disabled:opacity-50"
            style={{ maxHeight: "80px", overflowY: "auto" }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className="rounded-lg bg-foreground p-2 text-background transition-opacity hover:opacity-80 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground/50">Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  );
}
