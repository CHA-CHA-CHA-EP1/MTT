import { useEffect, useRef, useState } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { AiConfig, AiProvider, PROVIDER_DEFAULTS, getAiConfig, listAiModels, saveAiConfig, testAiConnection, initWorker } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { WHISPER_MODELS, useWhisperStore } from "@/lib/whisperConfig";

interface Props {
  open: boolean;
  onClose: () => void;
}

const PROVIDERS: AiProvider[] = ["anthropic", "openai", "custom"];

export function SettingsModal({ open, onClose }: Props) {
  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState(PROVIDER_DEFAULTS.anthropic.model);
  const { model: whisperModel, save: saveWhisper } = useWhisperStore();
  const [pendingWhisperModel, setPendingWhisperModel] = useState(whisperModel);
  const [reloading, setReloading] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "error" | null>(null);
  const [testError, setTestError] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setPendingWhisperModel(whisperModel);
  }, [open, whisperModel]);

  useEffect(() => {
    if (!open) return;
    getAiConfig().then((cfg) => {
      if (!cfg) return;
      setProvider(cfg.provider);
      setApiKey(cfg.api_key);
      setBaseUrl(cfg.base_url ?? "");
      setModel(cfg.model);
    });
  }, [open]);

  const buildConfig = (): AiConfig => ({
    provider,
    api_key: apiKey,
    base_url: provider === "custom" ? baseUrl || undefined : undefined,
    model,
  });

  const handleFetchModels = async () => {
    if (!apiKey) return;
    setFetchingModels(true);
    setTestResult(null);
    try {
      const list = await listAiModels(buildConfig());
      setModels(list);
      if (list.length === 0) {
        setTestResult("error");
        setTestError("No models returned");
      }
    } catch (e: unknown) {
      setModels([]);
      setTestResult("error");
      const msg = typeof e === "object" && e !== null && "message" in e
        ? String((e as { message: unknown }).message)
        : String(e);
      setTestError(msg);
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError("");
    try {
      await testAiConnection(buildConfig());
      setTestResult("ok");
    } catch (e: unknown) {
      setTestResult("error");
      const msg = typeof e === "object" && e !== null && "message" in e
        ? String((e as { message: unknown }).message)
        : String(e);
      setTestError(msg);
    } finally {
      setTesting(false);
    }
  };

  const handleProviderChange = (p: AiProvider) => {
    setProvider(p);
    if (p !== "custom") setModel(PROVIDER_DEFAULTS[p].model);
    if (p !== "custom") setBaseUrl("");
  };

  const handleSave = async () => {
    setSaving(true);
    await saveAiConfig(buildConfig());
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleWhisperModelChange = async (newModel: string) => {
    const previousModel = pendingWhisperModel;
    setPendingWhisperModel(newModel);
    setReloading(true);
    setInitError(null);

    // Listen for a global init error (id === "") before marking ready
    const unlisten = await listen<{ id: string; message: string }>("worker:error", (ev) => {
      if (ev.payload.id === "") {
        setInitError(ev.payload.message);
        setPendingWhisperModel(previousModel);    // revert UI
        saveWhisper(previousModel);               // revert saved setting
        setReloading(false);
      }
    });
    const unlistenReady = await listen("worker:ready", () => {
      setReloading(false);
      unlisten();
      unlistenReady();
    });

    await saveWhisper(newModel);
    await initWorker(newModel);
  };

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="relative w-full max-w-md rounded-2xl border bg-background p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Transcription Model */}
        <div className="mb-6">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">Transcription Model</p>
          <div className="space-y-1.5">
            {WHISPER_MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => handleWhisperModelChange(m.id)}
                disabled={reloading}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-60",
                  pendingWhisperModel === m.id
                    ? "border-foreground/40 bg-foreground/5"
                    : "hover:bg-accent"
                )}
              >
                <div>
                  <p className="text-sm font-medium leading-tight">{m.label}</p>
                  <p className="text-xs text-muted-foreground">{m.description}</p>
                </div>
                <div className="ml-3 shrink-0">
                  {reloading && pendingWhisperModel === m.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : pendingWhisperModel === m.id ? (
                    <span className="h-2 w-2 rounded-full bg-foreground block" />
                  ) : null}
                </div>
              </button>
            ))}
          </div>
          {reloading && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Downloading &amp; loading model...
            </p>
          )}
          {initError && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{initError}</span>
            </div>
          )}
        </div>

        <p className="mb-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">AI Provider</p>

        {/* Provider tabs */}
        <div className="mb-4 flex gap-1 rounded-lg border p-1">
          {PROVIDERS.map((p) => (
            <button
              key={p}
              onClick={() => handleProviderChange(p)}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                provider === p
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {PROVIDER_DEFAULTS[p].label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {/* API Key */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-foreground/30"
            />
          </div>

          {/* Base URL — custom only */}
          {provider === "custom" && (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Base URL</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://your-litellm.company.com/v1"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-foreground/30"
              />
            </div>
          )}

          {/* Model */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs text-muted-foreground">Model</label>
              <button
                onClick={handleFetchModels}
                disabled={!apiKey || fetchingModels}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground disabled:opacity-40"
              >
                {fetchingModels ? "Fetching..." : "Fetch models"}
              </button>
            </div>
            {models.length > 0 ? (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-foreground/30"
              >
                {model && !models.includes(model) && (
                  <option value={model}>{model}</option>
                )}
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="claude-sonnet-4-6"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-foreground/30"
              />
            )}
          </div>
        </div>

        {testResult && (
          <div className={cn(
            "mt-4 rounded-lg px-3 py-2 text-xs",
            testResult === "ok"
              ? "bg-green-500/10 text-green-600 dark:text-green-400"
              : "bg-destructive/10 text-destructive"
          )}>
            {testResult === "ok" ? "Connection successful ✓" : testError || "Connection failed"}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={handleTest}
            disabled={testing || !apiKey}
            className="rounded-lg border px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-foreground px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {saved ? "Saved ✓" : saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
