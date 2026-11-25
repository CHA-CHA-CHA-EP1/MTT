import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, Plus, Pencil, Trash2, Settings, Pin, PinOff } from "lucide-react";
import { useSpaceStore } from "./spaceStore";
import { ThemeToggle } from "@/common/components/ThemeToggle";
import { SettingsModal } from "@/modules/settings/SettingsModal";
import { formatTimestamp } from "@/lib/utils";
import type { Space } from "@/lib/tauri";

export function SpacePickerPage() {
  const navigate = useNavigate();
  const { spaces, loading, fetch, create, rename, pin, remove } = useSpaceStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const pinnedSpaces = spaces.filter((s) => s.pinned);
  const otherSpaces = spaces.filter((s) => !s.pinned);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight text-foreground">mtt</span>
          <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">0.0.1</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded p-1.5 text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </button>
          <ThemeToggle />
        </div>
      </header>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <div className="flex-1 overflow-y-auto px-6 pb-8 pt-8">
        <div className="mb-6 flex items-end justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Spaces</h1>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-80"
          >
            <Plus className="h-3.5 w-3.5" />
            New Space
          </button>
        </div>

        {creating && (
          <div className="mb-6 flex gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="Space name..."
              className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-foreground/30"
            />
            <button onClick={handleCreate} className="rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background">Create</button>
            <button onClick={() => setCreating(false)} className="rounded-lg border px-3 py-2 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        )}

        {loading ? (
          <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">Loading...</div>
        ) : spaces.length === 0 ? (
          <EmptyState onNew={() => setCreating(true)} />
        ) : (
          <div className="flex flex-col gap-6">
            {pinnedSpaces.length > 0 && (
              <div>
                <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">Pinned</p>
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
                  {pinnedSpaces.map((sp) => (
                    <SpaceCard
                      key={sp.id}
                      space={sp}
                      pinned
                      editingId={editingId}
                      editName={editName}
                      setEditName={setEditName}
                      onOpen={() => navigate(`/spaces/${sp.id}`)}
                      onRename={() => { setEditingId(sp.id); setEditName(sp.name); }}
                      onRenameSubmit={() => handleRename(sp.id)}
                      onRenameCancel={() => setEditingId(null)}
                      onPin={() => pin(sp.id, false)}
                      onRemove={() => remove(sp.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {otherSpaces.length > 0 && (
              <div>
                {pinnedSpaces.length > 0 && (
                  <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">All Spaces</p>
                )}
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
                  {otherSpaces.map((sp) => (
                    <SpaceCard
                      key={sp.id}
                      space={sp}
                      pinned={false}
                      editingId={editingId}
                      editName={editName}
                      setEditName={setEditName}
                      onOpen={() => navigate(`/spaces/${sp.id}`)}
                      onRename={() => { setEditingId(sp.id); setEditName(sp.name); }}
                      onRenameSubmit={() => handleRename(sp.id)}
                      onRenameCancel={() => setEditingId(null)}
                      onPin={() => pin(sp.id, true)}
                      onRemove={() => remove(sp.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SpaceCard({
  space, pinned, editingId, editName, setEditName,
  onOpen, onRename, onRenameSubmit, onRenameCancel, onPin, onRemove,
}: {
  space: Space;
  pinned: boolean;
  editingId: string | null;
  editName: string;
  setEditName: (v: string) => void;
  onOpen: () => void;
  onRename: () => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onPin: () => void;
  onRemove: () => void;
}) {
  const editing = editingId === space.id;
  return (
    <div className="group relative overflow-hidden rounded-xl border bg-card transition-colors hover:bg-accent">
      <button
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        onClick={!editing ? onOpen : undefined}
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground/10">
          <Layers className="h-3 w-3 text-foreground/60" />
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRenameSubmit();
                if (e.key === "Escape") onRenameCancel();
              }}
              onBlur={onRenameSubmit}
              onClick={(e) => e.stopPropagation()}
              className="w-full rounded border bg-background px-2 py-0.5 text-xs font-semibold outline-none focus:ring-1 focus:ring-foreground/30"
            />
          ) : (
            <p className="truncate text-xs font-medium leading-snug">{space.name}</p>
          )}
          <p className="truncate text-[10px] text-muted-foreground">{formatTimestamp(space.created_at)}</p>
        </div>
      </button>

      {/* Action buttons — absolute right, gradient bg so text fades out cleanly */}
      <div className="absolute inset-y-0 right-0 flex translate-x-full items-center gap-0.5 bg-accent px-1.5 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100">
        <button
          onClick={(e) => { e.stopPropagation(); onRename(); }}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          title="Rename"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onPin(); }}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          title={pinned ? "Unpin" : "Pin"}
        >
          {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="rounded p-1 text-muted-foreground hover:text-destructive"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border bg-card">
        <Layers className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">No spaces yet</p>
        <p className="mt-1 text-xs text-muted-foreground">Create a space to start transcribing</p>
      </div>
      <button
        onClick={onNew}
        className="mt-1 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
      >
        <Plus className="h-3.5 w-3.5" />
        Create your first space
      </button>
    </div>
  );
}
