import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Monitor, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WindowInfo } from "@/lib/tauri";
import { listWindows } from "@/lib/tauri";

interface Props {
  onSelect: (window: WindowInfo) => void;
  onClose: () => void;
}

export function WindowPickerModal({ onSelect, onClose }: Props) {
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    const unlisten = listen<WindowInfo[]>("recorder:windows", (ev) => {
      setWindows(ev.payload);
      setLoading(false);
    });

    listWindows().catch((e) => {
      setError(String(e));
      setLoading(false);
    });

    return () => { unlisten.then(fn => fn()); };
  }, []);

  const handleConfirm = () => {
    const win = windows.find(w => w.id === selected);
    if (win) onSelect(win);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[480px] rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Select Window to Record</span>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-4 text-center text-sm text-destructive">
              <p>{error}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Make sure Screen Recording permission is granted in System Settings → Privacy & Security.
              </p>
            </div>
          ) : windows.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No windows found. Make sure Screen Recording permission is granted.
            </div>
          ) : (
            <ul className="space-y-1">
              {windows.map((w) => (
                <li key={w.id}>
                  <button
                    className={cn(
                      "w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
                      selected === w.id && "bg-accent ring-1 ring-primary"
                    )}
                    onClick={() => setSelected(w.id)}
                    onDoubleClick={() => { setSelected(w.id); onSelect(w); }}
                  >
                    <p className="text-sm font-medium leading-tight">{w.title}</p>
                    <p className="text-xs text-muted-foreground">{w.app}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={selected === null}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40 hover:opacity-90"
          >
            Start Recording
          </button>
        </div>
      </div>
    </div>
  );
}
