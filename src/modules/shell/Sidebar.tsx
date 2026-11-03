import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown, ChevronRight, FileVideo, Folder, FolderOpen,
  Loader2, Monitor, Plus, Trash2, Video, Square, CheckCircle,
  XCircle, Clock, Pencil, Inbox,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useJobStore } from "@/modules/library/jobStore";
import { useFolderStore } from "@/modules/folders/folderStore";
import { useWorkerEvents } from "@/common/hooks/useWorkerEvents";
import { useWhisperStore } from "@/lib/whisperConfig";
import { useRecording } from "@/modules/recording/useRecording";
import { WindowPickerModal } from "@/modules/recording/WindowPickerModal";
import * as api from "@/lib/tauri";
import type { Job } from "@/lib/tauri";
import { cn, formatDuration } from "@/lib/utils";

const StatusIcon = ({ status }: { status: Job["status"] }) => {
  switch (status) {
    case "recording": return (
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
    );
    case "running": return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />;
    case "done": return <CheckCircle className="h-3 w-3 shrink-0 text-green-500" />;
    case "error": return <XCircle className="h-3 w-3 shrink-0 text-destructive" />;
    case "cancelled": return <XCircle className="h-3 w-3 shrink-0 text-muted-foreground" />;
    default: return <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />;
  }
};

interface SidebarProps {
  spaceId: string;
  selectedJobId: string | null;
  onSelectJob: (jobId: string) => void;
}

export function Sidebar({ spaceId, selectedJobId, onSelectJob }: SidebarProps) {
  const navigate = useNavigate();
  const { jobs, loading: jobsLoading, setActiveSpace, updateStatus, remove } = useJobStore();
  const { folders, loading: foldersLoading, setActiveSpace: setFolderSpace, create: createFolder, rename: renameFolder, remove: removeFolder } = useFolderStore();
  const whisperModel = useWhisperStore((s) => s.model);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showWindowPicker, setShowWindowPicker] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");

  useEffect(() => {
    setActiveSpace(spaceId);
    setFolderSpace(spaceId);
  }, [spaceId]);

  // Listen for recording stopped to update job status in sidebar
  useEffect(() => {
    const unlisten = listen<{ id: string }>("recorder:stopped", (ev) => {
      updateStatus(ev.payload.id, "running");
    });
    const unlistenErr = listen<{ id: string }>("recorder:error", (ev) => {
      if (ev.payload.id) updateStatus(ev.payload.id, "error");
    });
    return () => {
      unlisten.then(fn => fn());
      unlistenErr.then(fn => fn());
    };
  }, []);

  useWorkerEvents({
    onDone: ({ id }) => updateStatus(id, "done"),
    onError: ({ id }) => updateStatus(id, "error"),
    onCancelled: ({ id }) => updateStatus(id, "cancelled"),
    onChunk: ({ id }) => updateStatus(id, "running"),
  });

  const { isRecording, elapsed, start, stop } = useRecording(spaceId, (jobId) => {
    setActiveSpace(spaceId);
    onSelectJob(jobId);
  });

  const handleImport = async () => {
    const selected = await open({ multiple: false, filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "m4v", "avi"] }] });
    if (!selected) return;
    await api.createJob(spaceId, selected as string, whisperModel);
    setActiveSpace(spaceId);
  };

  const toggleFolder = (id: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const id = await createFolder(spaceId, newFolderName.trim());
    setExpandedFolders(prev => new Set(prev).add(id));
    setNewFolderName("");
    setCreatingFolder(false);
  };

  const handleRenameFolder = async (id: string) => {
    if (!editFolderName.trim()) { setEditingFolderId(null); return; }
    await renameFolder(id, editFolderName.trim());
    setEditingFolderId(null);
  };

  const jobLabel = (job: Job) => job.recording_window ?? job.file_path.split("/").pop() ?? job.id;

  const inboxJobs = jobs.filter(j => !j.folder_id);
  const jobsByFolder = (folderId: string) => jobs.filter(j => j.folder_id === folderId);

  const MeetingItem = ({ job }: { job: Job }) => (
    <div
      className={cn(
        "group flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs",
        selectedJobId === job.id
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      )}
      onClick={() => {
        if (job.status !== "pending" && job.status !== "recording") onSelectJob(job.id);
      }}
    >
      {job.recording_window ? <Monitor className="h-3 w-3 shrink-0" /> : <FileVideo className="h-3 w-3 shrink-0" />}
      <span className="flex-1 truncate">{jobLabel(job)}</span>
      <StatusIcon status={job.status} />
      <button
        onClick={(e) => { e.stopPropagation(); remove(job.id); }}
        className="hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r bg-background">
      {/* Quick actions */}
      <div className="space-y-1 p-2">
        {isRecording ? (
          <button
            onClick={stop}
            className="flex w-full items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            Stop · {formatDuration(elapsed)}
          </button>
        ) : (
          <button
            onClick={() => setShowWindowPicker(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            <Video className="h-3.5 w-3.5" />
            Record
          </button>
        )}
        <button
          onClick={handleImport}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
        >
          <FileVideo className="h-3.5 w-3.5" />
          Import Video
        </button>
      </div>

      <div className="mx-2 border-t" />

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-2">
        {jobsLoading || foldersLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-0.5">
            {/* Folders */}
            {folders.map((folder) => {
              const folderJobs = jobsByFolder(folder.id);
              const expanded = expandedFolders.has(folder.id);
              return (
                <div key={folder.id}>
                  <div className="group flex items-center gap-1 rounded px-1 py-1 hover:bg-accent/50">
                    <button onClick={() => toggleFolder(folder.id)} className="flex flex-1 items-center gap-1 text-xs font-medium text-foreground">
                      {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                      {expanded ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      {editingFolderId === folder.id ? (
                        <input
                          autoFocus
                          value={editFolderName}
                          onChange={(e) => setEditFolderName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameFolder(folder.id);
                            if (e.key === "Escape") setEditingFolderId(null);
                          }}
                          onBlur={() => handleRenameFolder(folder.id)}
                          className="w-full rounded bg-background px-1 text-xs outline-none ring-1 ring-foreground/20"
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="truncate">{folder.name}</span>
                      )}
                    </button>
                    <div className="hidden items-center gap-0.5 group-hover:flex">
                      <button onClick={() => { setEditingFolderId(folder.id); setEditFolderName(folder.name); }} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button onClick={() => removeFolder(folder.id)} className="rounded p-0.5 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <div className="ml-4 mt-0.5 space-y-0.5">
                      {folderJobs.length === 0 ? (
                        <p className="px-2 py-1 text-[11px] text-muted-foreground/50">Empty</p>
                      ) : (
                        folderJobs.map(job => <MeetingItem key={job.id} job={job} />)
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* New folder input */}
            {creatingFolder && (
              <div className="flex items-center gap-1 px-1 py-1">
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateFolder();
                    if (e.key === "Escape") setCreatingFolder(false);
                  }}
                  onBlur={() => { if (newFolderName.trim()) handleCreateFolder(); else setCreatingFolder(false); }}
                  placeholder="Folder name..."
                  className="flex-1 rounded bg-background px-1 text-xs outline-none ring-1 ring-foreground/20"
                />
              </div>
            )}

            {/* Inbox */}
            {inboxJobs.length > 0 && (
              <div className="mt-1">
                <div className="flex items-center gap-1 px-1 py-1">
                  <Inbox className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Inbox</span>
                  {inboxJobs.length > 0 && (
                    <span className="ml-auto rounded bg-muted px-1 text-[10px] text-muted-foreground">{inboxJobs.length}</span>
                  )}
                </div>
                <div className="ml-4 space-y-0.5">
                  {inboxJobs.map(job => <MeetingItem key={job.id} job={job} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="border-t p-2">
        <button
          onClick={() => setCreatingFolder(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          New Folder
        </button>
        <button
          onClick={() => navigate("/")}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          ‹ All Spaces
        </button>
      </div>

      {showWindowPicker && (
        <WindowPickerModal
          onSelect={async (win, micOptions) => {
            setShowWindowPicker(false);
            await start(win, micOptions);
          }}
          onClose={() => setShowWindowPicker(false)}
        />
      )}
    </aside>
  );
}
