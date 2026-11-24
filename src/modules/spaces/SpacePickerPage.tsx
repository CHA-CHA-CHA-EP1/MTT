import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, Plus, Pencil, Trash2, ChevronRight, Settings, Pin, PinOff } from "lucide-react";
import { useSpaceStore } from "./spaceStore";
import { ThemeToggle } from "@/common/components/ThemeToggle";
import { SettingsModal } from "@/modules/settings/SettingsModal";
import { cn, formatTimestamp } from "@/lib/utils";
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

  const pinnedSpace = spaces.find((s) => s.pinned) ?? null;
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

      <div className="mx-auto w-full max-w-xl flex-1 overflow-y-auto px-5 pb-8 pt-10">
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
          <div className="mb-4 flex gap-2">
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
          <div className="flex flex-col gap-4">
            {/* Pinned / featured space */}
            {pinnedSpace ? (
              <PinnedCard
                space={pinnedSpace}
                editingId={editingId}
                editName={editName}
                setEditName={setEditName}
                onOpen={() => navigate(`/spaces/${pinnedSpace.id}`)}
                onRename={() => { setEditingId(pinnedSpace.id); setEditName(pinnedSpace.name); }}
                onRenameSubmit={() => handleRename(pinnedSpace.id)}
                onRenameCancel={() => setEditingId(null)}
                onUnpin={() => pin(pinnedSpace.id, false)}
                onRemove={() => remove(pinnedSpace.id)}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Pin a space to feature it here.
              </p>
            )}

            {/* Other spaces */}
            {otherSpaces.length > 0 && (
              <div>
                {pinnedSpace && (
                  <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">Other spaces</p>
                )}
                <ul className="divide-y divide-border overflow-hidden rounded-xl border">
                  {otherSpaces.map((sp, i) => (
                    <SpaceRow
                      key={sp.id}
                      space={sp}
                      first={i === 0}
                      last={i === otherSpaces.length - 1}
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
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PinnedCard({
  space, editingId, editName, setEditName,
  onOpen, onRename, onRenameSubmit, onRenameCancel, onUnpin, onRemove,
}: {
  space: Space;
  editingId: string | null;
  editName: string;
  setEditName: (v: string) => void;
  onOpen: () => void;
  onRename: () => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onUnpin: () => void;
  onRemove: () => void;
}) {
  const editing = editingId === space.id;
  return (
    <div className="group relative overflow-hidden rounded-2xl border bg-card transition-colors hover:bg-accent">
      <button
        className="w-full px-5 py-5 text-left"
        onClick={!editing ? onOpen : undefined}
      >
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-foreground/10">
          <Layers className="h-5 w-5 text-foreground/60" />
        </div>
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
            className="w-full rounded border bg-background px-2 py-0.5 text-lg font-semibold outline-none focus:ring-1 focus:ring-foreground/30"
          />
        ) : (
          <p className="text-lg font-semibold leading-tight">{space.name}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{formatTimestamp(space.created_at)}</p>
      </button>

      {/* Action buttons — top-right */}
      <div className="absolute right-3 top-3 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onRename}
          className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
          title="Rename"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onUnpin}
          className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
          title="Unpin"
        >
          <PinOff className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onRemove}
          className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-destructive"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function SpaceRow({
  space, first, last, editingId, editName, setEditName,
  onOpen, onRename, onRenameSubmit, onRenameCancel, onPin, onRemove,
}: {
  space: Space;
  first: boolean;
  last: boolean;
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
    <li
      className={cn(
        "group relative flex items-center gap-3 bg-card px-4 py-3 transition-colors hover:bg-accent",
        first && "rounded-t-xl",
        last && "rounded-b-xl"
      )}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
      </div>

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
          className="flex-1 rounded border bg-background px-2 py-0.5 text-sm outline-none focus:ring-1 focus:ring-foreground/30"
        />
      ) : (
        <button
          className="flex flex-1 flex-col items-start gap-0.5 text-left"
          onClick={onOpen}
        >
          <span className="text-sm font-medium leading-snug">{space.name}</span>
          <span className="text-xs text-muted-foreground">{formatTimestamp(space.created_at)}</span>
        </button>
      )}

      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onRename}
          className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
          title="Rename"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onPin}
          className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
          title="Pin to top"
        >
          <Pin className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onRemove}
          className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-destructive"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
    </li>
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
