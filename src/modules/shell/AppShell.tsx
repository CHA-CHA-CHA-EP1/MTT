import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Settings, Search } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { TranscriptPage } from "@/modules/transcript/TranscriptPage";
import { ThemeToggle } from "@/common/components/ThemeToggle";
import { SettingsModal } from "@/modules/settings/SettingsModal";
import { SearchModal } from "@/modules/search/SearchModal";
import { useSpaceStore } from "@/modules/spaces/spaceStore";
import { useVimModeState } from "@/lib/vimModeState";

export function AppShell() {
  const navigate = useNavigate();
  const { spaceId, jobId: routeJobId } = useParams<{ spaceId: string; jobId?: string }>();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(routeJobId ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [pendingSeek, setPendingSeek] = useState<number | undefined>(undefined);
  const { spaces, fetch } = useSpaceStore();

  useEffect(() => { fetch(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if (e.key === "u" || e.key === "U") {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
        if (useVimModeState.getState().isNormalMode) return;
        navigate("/");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  const handleSearchSelect = useCallback((result: import("@/lib/tauri").SearchResult) => {
    setSelectedJobId(result.job_id);
    setPendingSeek(result.start ?? undefined);
  }, []);

  const space = spaces.find(s => s.id === spaceId);

  if (!spaceId) return null;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight">mtt</span>
          <span className="text-xs text-muted-foreground/50">/</span>
          <span className="text-xs text-muted-foreground">{space?.name ?? spaceId}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
            title="Search (⌘K)"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline rounded border px-1 py-0.5 text-[10px] font-mono opacity-50">⌘K</kbd>
          </button>
          <button onClick={() => setSettingsOpen(true)} className="rounded p-1.5 text-muted-foreground hover:text-foreground">
            <Settings className="h-4 w-4" />
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          spaceId={spaceId}
          selectedJobId={selectedJobId}
          onSelectJob={setSelectedJobId}
        />

        <main className="flex flex-1 overflow-hidden">
          {selectedJobId ? (
            <TranscriptPage key={selectedJobId} jobId={selectedJobId} panelOpen={panelOpen} onPanelOpenChange={setPanelOpen} initialSeek={pendingSeek} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <p className="text-sm">Select a meeting to view the transcript</p>
              <p className="text-xs opacity-60">or record / import a new one</p>
            </div>
          )}
        </main>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <SearchModal
        spaceId={spaceId}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={handleSearchSelect}
      />
    </div>
  );
}
