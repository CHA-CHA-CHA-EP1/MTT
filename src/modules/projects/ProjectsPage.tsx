import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, Plus, Pencil, Trash2, ChevronRight } from "lucide-react";
import { useProjectStore } from "./projectStore";
import { ThemeToggle } from "@/common/components/ThemeToggle";
import { cn, formatTimestamp } from "@/lib/utils";

export function ProjectsPage() {
  const navigate = useNavigate();
  const { projects, loading, fetch, create, rename, remove } = useProjectStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => { fetch(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await create(newName.trim());
    setNewName("");
    setCreating(false);
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) { setEditingId(null); return; }
    await rename(id, editName.trim());
    setEditingId(null);
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight text-foreground">mtt</span>
          <span className="text-xs text-muted-foreground/50">/</span>
          <span className="text-sm text-muted-foreground">Projects</span>
        </div>
        <ThemeToggle />
      </header>

      <div className="mx-auto w-full max-w-xl flex-1 overflow-y-auto px-5 pb-8 pt-12">
        {/* Title row */}
        <div className="mb-8 flex items-end justify-between">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">Workspace</p>
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-80"
          >
            <Plus className="h-3.5 w-3.5" />
            New Project
          </button>
        </div>

        {/* New project input */}
        {creating && (
          <div className="mb-4 flex gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="Project name..."
              className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-foreground/30"
            />
            <button
              onClick={handleCreate}
              className="rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background"
            >
              Create
            </button>
            <button
              onClick={() => setCreating(false)}
              className="rounded-lg border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Project list */}
        {loading ? (
          <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
            Loading...
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border bg-card">
              <FolderOpen className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">No projects yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Create a project to start transcribing</p>
            </div>
            <button
              onClick={() => setCreating(true)}
              className="mt-1 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" />
              Create your first project
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border">
            {projects.map((p, i) => (
              <li
                key={p.id}
                className={cn(
                  "group relative flex items-center gap-3 bg-card px-4 py-3 transition-colors hover:bg-accent",
                  i === 0 && "rounded-t-xl",
                  i === projects.length - 1 && "rounded-b-xl"
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                </div>

                {editingId === p.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(p.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => handleRename(p.id)}
                    className="flex-1 rounded border bg-background px-2 py-0.5 text-sm outline-none focus:ring-1 focus:ring-foreground/30"
                  />
                ) : (
                  <button
                    className="flex flex-1 flex-col items-start gap-0.5 text-left"
                    onClick={() => navigate(`/projects/${p.id}`)}
                  >
                    <span className="text-sm font-medium leading-snug">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{formatTimestamp(p.created_at)}</span>
                  </button>
                )}

                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => { setEditingId(p.id); setEditName(p.name); }}
                    className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
