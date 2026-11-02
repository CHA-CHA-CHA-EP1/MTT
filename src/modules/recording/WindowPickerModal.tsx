import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Monitor, Loader2, X, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WindowInfo } from "@/lib/tauri";
import { listWindows, captureWindowScreenshot } from "@/lib/tauri";

interface Props {
  onSelect: (window: WindowInfo) => void;
  onClose: () => void;
}

type Step = "pick" | "preview";

export function WindowPickerModal({ onSelect, onClose }: Props) {
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const [step, setStep] = useState<Step>("pick");
  const [previewWindow, setPreviewWindow] = useState<WindowInfo | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;

    const init = async () => {
      unlistenFn = await listen<WindowInfo[]>("recorder:windows", (ev) => {
        if (!cancelled) {
          setWindows(ev.payload);
          setLoading(false);
        }
      });
      const unlistenErr = await listen<{ id: string; message: string }>("recorder:error", (ev) => {
        if (!cancelled && ev.payload.id === "") {
          setError(ev.payload.message);
          setLoading(false);
        }
      });
      const originalUnlisten = unlistenFn;
      unlistenFn = () => { originalUnlisten(); unlistenErr(); };
      try {
        await listWindows();
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      unlistenFn?.();
      unlistenRef.current?.();
    };
  }, []);

  const handlePreview = async () => {
    const win = windows.find(w => w.id === selected);
    if (!win) return;

    setPreviewLoading(true);
    setPreviewWindow(win);
    setPreviewSrc(null);

    // Clean up any previous screenshot listener
    unlistenRef.current?.();

    const unlisten = await listen<{ path: string }>("recorder:screenshot", (ev) => {
      setPreviewSrc(convertFileSrc(ev.payload.path));
      setPreviewLoading(false);
      setStep("preview");
      unlistenRef.current?.();
      unlistenRef.current = null;
    });
    unlistenRef.current = unlisten;

    try {
      await captureWindowScreenshot(win.id);
    } catch (e) {
      unlisten();
      unlistenRef.current = null;
      setPreviewLoading(false);
      console.error("screenshot failed:", e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[520px] rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            {step === "preview" && (
              <button
                onClick={() => { setStep("pick"); setPreviewSrc(null); }}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <Monitor className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {step === "pick" ? "Select Window to Record" : "Preview"}
            </span>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === "pick" ? (
          <>
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
                        onDoubleClick={() => { setSelected(w.id); handlePreview(); }}
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
                onClick={handlePreview}
                disabled={selected === null || previewLoading}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40 hover:opacity-90"
              >
                {previewLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                Preview
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="p-4">
              <div className="overflow-hidden rounded-lg border bg-muted">
                {previewSrc ? (
                  <img src={previewSrc} alt="Window preview" className="w-full object-contain" />
                ) : (
                  <div className="flex h-48 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
              {previewWindow && (
                <div className="mt-3">
                  <p className="text-sm font-medium">{previewWindow.title}</p>
                  <p className="text-xs text-muted-foreground">{previewWindow.app}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <button
                onClick={() => { setStep("pick"); setPreviewSrc(null); }}
                className="rounded-lg border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                Back
              </button>
              <button
                onClick={() => previewWindow && onSelect(previewWindow)}
                className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-300 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                </span>
                Start Recording
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
