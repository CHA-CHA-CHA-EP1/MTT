import { useState } from "react";
import { useParams } from "react-router-dom";
import { Settings } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { TranscriptPage } from "@/modules/transcript/TranscriptPage";
import { ThemeToggle } from "@/common/components/ThemeToggle";
import { SettingsModal } from "@/modules/settings/SettingsModal";
import { useSpaceStore } from "@/modules/spaces/spaceStore";
import { useEffect } from "react";

export function AppShell() {
  const { spaceId, jobId: routeJobId } = useParams<{ spaceId: string; jobId?: string }>();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(routeJobId ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const { spaces, fetch } = useSpaceStore();

  useEffect(() => { fetch(); }, []);

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
            <TranscriptPage key={selectedJobId} jobId={selectedJobId} panelOpen={panelOpen} onPanelOpenChange={setPanelOpen} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <p className="text-sm">Select a meeting to view the transcript</p>
              <p className="text-xs opacity-60">or record / import a new one</p>
            </div>
          )}
        </main>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
