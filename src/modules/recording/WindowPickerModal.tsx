import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Monitor, Loader2, X, ArrowLeft, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WindowInfo, MicOptions } from "@/lib/tauri";
import { listWindows, captureWindowScreenshot } from "@/lib/tauri";

interface Props {
  onSelect: (window: WindowInfo, micOptions: MicOptions) => void;
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

  // Mic state
  const [micEnabled, setMicEnabled] = useState(false);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [micDeviceId, setMicDeviceId] = useState<string>("");
  const [micLevel, setMicLevel] = useState(0);

  // Enumerate mic devices on mount (need getUserMedia first for labels)
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then((devices) => {
        const inputs = devices.filter((d) => d.kind === "audioinput");
        setMicDevices(inputs);
        if (inputs.length > 0) setMicDeviceId(inputs[0].deviceId);
      })
      .catch(() => {
        // Ignore permission errors — mic toggle will still work, just no level meter
      });
  }, []);

  // Level meter effect — runs when in preview step and mic is enabled
  useEffect(() => {
    if (step !== "preview" || !micEnabled) {
      setMicLevel(0);
      return;
    }

    let animFrame: number;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;

    const setup = async () => {
      try {
        const constraints: MediaStreamConstraints = {
          audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setMicLevel(avg / 255);
          animFrame = requestAnimationFrame(tick);
        };
        animFrame = requestAnimationFrame(tick);
      } catch {
        // mic unavailable — ignore
      }
    };

    setup();

    return () => {
      cancelAnimationFrame(animFrame);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
      setMicLevel(0);
    };
  }, [step, micEnabled, micDeviceId]);

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

              {/* Mic settings panel */}
              <div className="mt-3 rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Mic className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Microphone</span>
                  </div>
                  {/* Toggle */}
                  <button
                    onClick={() => setMicEnabled(v => !v)}
                    className={cn(
                      "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                      micEnabled ? "bg-primary" : "bg-muted"
                    )}
                  >
                    <span className={cn(
                      "inline-block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white shadow transition-transform",
                      micEnabled && "translate-x-4"
                    )} />
                  </button>
                </div>

                {micEnabled && (
                  <>
                    {/* Device selector */}
                    {micDevices.length > 1 && (
                      <select
                        value={micDeviceId}
                        onChange={e => setMicDeviceId(e.target.value)}
                        className="w-full rounded border bg-background px-2 py-1 text-xs text-foreground"
                      >
                        {micDevices.map(d => (
                          <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>
                        ))}
                      </select>
                    )}

                    {/* Level meter — 20 bars */}
                    <div className="flex items-end gap-0.5 h-5">
                      {Array.from({ length: 20 }, (_, i) => (
                        <div
                          key={i}
                          className={cn(
                            "flex-1 rounded-sm transition-all duration-75",
                            micLevel * 20 > i ? "bg-green-500" : "bg-muted"
                          )}
                          style={{ height: `${Math.max(20, Math.min(100, 20 + (i < micLevel * 20 ? (i / 20) * 80 : 0)))}%` }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <button
                onClick={() => { setStep("pick"); setPreviewSrc(null); }}
                className="rounded-lg border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                Back
              </button>
              <button
                onClick={() => {
                  if (!previewWindow) return;
                  const selectedDevice = micDevices.find(d => d.deviceId === micDeviceId);
                  onSelect(previewWindow, {
                    enabled: micEnabled,
                    deviceLabel: selectedDevice?.label ?? "",
                  });
                }}
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
