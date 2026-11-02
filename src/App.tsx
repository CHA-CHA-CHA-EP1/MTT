import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useTheme } from "@/common/hooks/useTheme";
import { useWorkerEvents } from "@/common/hooks/useWorkerEvents";
import { GlobalTranscriptionStatus } from "@/common/components/GlobalTranscriptionStatus";
import { ProjectsPage } from "@/modules/projects/ProjectsPage";
import { LibraryPage } from "@/modules/library/LibraryPage";
import { TranscriptPage } from "@/modules/transcript/TranscriptPage";
import { initWorker } from "@/lib/tauri";
import { useWhisperStore } from "@/lib/whisperConfig";

function ThemeProvider({ children }: { children: React.ReactNode }) {
  useTheme();
  return <>{children}</>;
}

function WorkerBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { load } = useWhisperStore();

  useWorkerEvents({ onReady: () => setReady(true) });

  useEffect(() => {
    load().then((model) => initWorker(model)).catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-destructive">
        <p className="text-sm font-medium">Failed to start worker</p>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Loading models...</p>
      </div>
    );
  }

  return (
    <>
      {children}
      <GlobalTranscriptionStatus />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <WorkerBootstrap>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<LibraryPage />} />
            <Route path="/projects/:projectId/jobs/:jobId" element={<TranscriptPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </WorkerBootstrap>
    </ThemeProvider>
  );
}
