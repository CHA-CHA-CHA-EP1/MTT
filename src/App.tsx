import { useTheme } from "@/common/hooks/useTheme";
import { GlobalTranscriptionStatus } from "@/common/components/GlobalTranscriptionStatus";
import { ProjectsPage } from "@/modules/projects/ProjectsPage";
import { LibraryPage } from "@/modules/library/LibraryPage";
import { TranscriptPage } from "@/modules/transcript/TranscriptPage";
import { SpacePickerPage } from "@/modules/spaces/SpacePickerPage";
import { AppShell } from "@/modules/shell/AppShell";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

function ThemeProvider({ children }: { children: React.ReactNode }) {
  useTheme();
  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SpacePickerPage />} />
          <Route path="/spaces/:spaceId" element={<AppShell />} />
          <Route path="/spaces/:spaceId/jobs/:jobId" element={<AppShell />} />
          {/* Legacy routes */}
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<LibraryPage />} />
          <Route path="/projects/:projectId/jobs/:jobId" element={<TranscriptPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <GlobalTranscriptionStatus />
    </ThemeProvider>
  );
}
