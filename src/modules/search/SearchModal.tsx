import { useEffect, useRef, useState } from "react";
import { Search, X, Clock, FileText } from "lucide-react";
import { searchAllSpaces, searchInSpace, type SearchResult } from "@/lib/tauri";
import { cn, formatDuration } from "@/lib/utils";

interface Props {
  spaceId?: string; // if omitted, searches all spaces
  open: boolean;
  onClose: () => void;
  onSelect: (result: SearchResult) => void;
}

export function SearchModal({ spaceId, open, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      const p = spaceId ? searchInSpace(spaceId, query) : searchAllSpaces(query);
      p.then((r) => { setResults(r); setSelectedIdx(0); })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [query, spaceId]);

  const handleSelect = (result: SearchResult) => {
    onSelect(result);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIdx]) {
      handleSelect(results[selectedIdx]);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/40"
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="w-full max-w-xl rounded-xl border bg-background shadow-2xl overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search transcripts and notes..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Results */}
        {query.trim().length >= 2 && (
          <div className="max-h-[400px] overflow-y-auto">
            {loading && results.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">No results found</div>
            ) : (
              <ul className="p-1.5 space-y-0.5">
                {results.map((r, i) => (
                  <li key={`${r.job_id}-${r.source}-${i}`}>
                    <button
                      className={cn(
                        "w-full rounded-lg px-3 py-2.5 text-left transition-colors",
                        i === selectedIdx ? "bg-accent" : "hover:bg-accent/60"
                      )}
                      onMouseEnter={() => setSelectedIdx(i)}
                      onClick={() => handleSelect(r)}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-medium truncate">{r.job_title}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {r.source === "transcript" && r.start != null ? (
                            <span className="flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              <Clock className="h-2.5 w-2.5" />
                              {formatDuration(r.start)}
                            </span>
                          ) : null}
                          <span className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                            r.source === "transcript"
                              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          )}>
                            {r.source === "transcript" ? (
                              <span className="flex items-center gap-1"><FileText className="h-2.5 w-2.5" />transcript</span>
                            ) : (
                              <span className="flex items-center gap-1"><FileText className="h-2.5 w-2.5" />notes</span>
                            )}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{r.snippet}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t px-4 py-2 text-[10px] text-muted-foreground/60">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
