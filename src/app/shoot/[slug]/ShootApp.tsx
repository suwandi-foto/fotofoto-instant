"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { enqueue, drainQueue, listAll, cancelItem, type QueueItem } from "@/lib/offlineQueue";
import { generateId } from "@/lib/ids";
import { Logo } from "@/app/Logo";

type PresetOption = { id: string; name: string; swatch: string; swatchType: "gradient" | "image" };
type SamplePreview = { id: string; name: string; previewDataUrl: string };

export function ShootApp({
  slug,
  eventName,
  initialPresets,
}: {
  slug: string;
  eventName: string;
  initialPresets: PresetOption[];
}) {
  const [presets] = useState<PresetOption[]>(initialPresets);
  const [preset, setPreset] = useState<string>(initialPresets[0]?.id ?? "warm");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  const sampleInputRef = useRef<HTMLInputElement>(null);
  const [testingSample, setTestingSample] = useState(false);
  const [sampleResults, setSampleResults] = useState<SamplePreview[] | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);

  const refreshQueue = useCallback(async () => {
    setQueue(await listAll());
  }, []);

  const refreshLiveCount = useCallback(async () => {
    const res = await fetch(`/api/events/${slug}/photos`, { cache: "no-store" });
    if (res.ok) setLiveCount((await res.json()).photos.length);
  }, [slug]);

  const runDrain = useCallback(async () => {
    await drainQueue(() => refreshQueue());
    await refreshLiveCount();
  }, [refreshQueue, refreshLiveCount]);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    refreshQueue();
    refreshLiveCount();

    const onOnline = () => {
      setIsOnline(true);
      runDrain();
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // Belt-and-braces retry loop, in case the browser's online event
    // doesn't fire reliably (e.g. flaky venue wifi that's "connected"
    // but not actually reaching the server).
    const interval = setInterval(runDrain, 6000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(interval);
    };
  }, [refreshQueue, refreshLiveCount, runDrain]);

  async function onFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      // A cancelled/failed camera capture can hand back a 0-byte
      // file (seen with some browsers' camera-capture flow) — skip
      // it here rather than queuing something the server can't
      // process as an image.
      if (file.size === 0) {
        console.warn(`Skipping "${file.name}" — it came through empty (0 bytes).`);
        continue;
      }
      await enqueue({
        id: generateId(),
        eventSlug: slug,
        preset,
        blob: file,
        fileName: file.name,
        createdAt: Date.now(),
      });
    }
    await refreshQueue();
    runDrain();
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (libraryInputRef.current) libraryInputRef.current.value = "";
  }

  async function onCancel(id: string) {
    await cancelItem(id);
    await refreshQueue();
  }

  async function onSampleSelected(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setTestingSample(true);
    setSampleError(null);
    setSampleResults(null);
    try {
      const form = new FormData();
      form.append("photo", file);
      const res = await fetch(`/api/events/${slug}/presets/test`, { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not render preview");
      const data = await res.json();
      setSampleResults(data.previews);
    } catch (err) {
      setSampleError((err as Error).message);
    } finally {
      setTestingSample(false);
      if (sampleInputRef.current) sampleInputRef.current.value = "";
    }
  }

  const pendingCount = queue.filter((q) => q.status !== "done").length;
  const shotsToday = queue.length + (liveCount ?? 0);
  const activePreset = presets.find((p) => p.id === preset);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-border px-5 pb-4 pt-6">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-1.5">
            <Logo className="text-sm tracking-wide" />
            <span className="font-display text-sm font-bold text-text-dim">&middot; Shoot</span>
          </Link>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-dim">
            <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-success" : "bg-red-400"}`} />
            {isOnline ? "Online" : "Offline — queuing locally"}
          </div>
        </div>
        <div>
          <div className="font-display text-xl font-semibold leading-tight">{eventName}</div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-gold">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9h4v6H4z" /><path d="M8 12h8" /><path d="M16 9h4v6h-4z" />
            </svg>
            Ready to capture
          </div>
        </div>
      </div>

      {/* Preset picker */}
      <div className="flex flex-col gap-2.5 px-5 pb-1 pt-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wide text-text-dim">Editing preset</div>
          <button
            onClick={() => sampleInputRef.current?.click()}
            disabled={testingSample}
            className="text-xs font-bold text-gold hover:underline disabled:opacity-50"
          >
            {testingSample ? "Rendering…" : "Test on a sample photo"}
          </button>
          <input
            ref={sampleInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onSampleSelected(e.target.files)}
          />
        </div>
        <div className="grid grid-cols-4 gap-2">
          {presets.map((p) => {
            const active = preset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                className="flex flex-col items-center gap-1.5"
              >
                <div
                  className="aspect-square w-full rounded bg-cover bg-center"
                  style={{
                    background: p.swatchType === "gradient" ? p.swatch : undefined,
                    backgroundImage: p.swatchType === "image" ? `url(${p.swatch})` : undefined,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    border: active ? "2.5px solid #d68a3c" : "2.5px solid transparent",
                  }}
                />
                <span className={`text-center text-[10.5px] font-bold leading-tight ${active ? "text-text" : "text-text-dim-2"}`}>
                  {p.name}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-text-dim-2">
          Applying <b className="text-gold">{activePreset?.name ?? preset}</b> to every new shot automatically.
        </p>

        {sampleError && <p className="text-xs text-red-400">{sampleError}</p>}

        {sampleResults && (
          <div className="flex flex-col gap-2 rounded border border-border bg-panel p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text-dim">Tap the look you want to use</span>
              <button onClick={() => setSampleResults(null)} className="text-xs text-text-dim-2 hover:text-text">
                Close
              </button>
            </div>
            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {sampleResults.map((r) => {
                const active = preset === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => setPreset(r.id)}
                    className="flex flex-shrink-0 flex-col items-center gap-1.5"
                    style={{ width: 96 }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.previewDataUrl}
                      alt={r.name}
                      className="h-24 w-24 rounded-sm object-cover"
                      style={{ outline: active ? "2.5px solid #d68a3c" : "2.5px solid transparent", outlineOffset: "-2.5px" }}
                    />
                    <span className={`text-center text-[10.5px] font-bold leading-tight ${active ? "text-text" : "text-text-dim-2"}`}>
                      {r.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Capture */}
      <div className="px-5 pt-4">
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => onFilesSelected(e.target.files)}
        />
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onFilesSelected(e.target.files)}
        />
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-col items-center gap-1.5 rounded-md border-2 border-dashed border-border py-5 text-center text-sm font-semibold text-text-dim hover:border-gold hover:text-gold"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Take Photo
          </button>
          <button
            onClick={() => libraryInputRef.current?.click()}
            className="flex flex-col items-center gap-1.5 rounded-md border-2 border-dashed border-border py-5 text-center text-sm font-semibold text-text-dim hover:border-gold hover:text-gold"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v13" />
              <path d="m7 11 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
            Upload
          </button>
        </div>
        <p className="mt-2 text-center text-xs font-normal text-text-dim-2">
          Take Photo opens the camera directly · Upload picks existing files
          from your library (stands in for the tethered USB import on the
          packaged app)
        </p>
      </div>

      {/* Upload queue */}
      <div className="flex flex-col gap-2.5 px-5 py-4">
        <div className="text-xs font-bold uppercase tracking-wide text-text-dim">Upload queue</div>
        {queue.length === 0 && (
          <p className="text-sm text-text-dim-2">Nothing queued — import a shot above to test the flow.</p>
        )}
        {queue.map((item) => (
          <div key={item.id} className="flex items-center gap-2.5 rounded bg-panel p-2">
            <div className="h-9 w-9 flex-shrink-0 rounded-sm bg-panel-2" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{item.fileName}</div>
              <div className="text-xs text-text-dim">
                {item.status === "queued" && "Waiting to upload…"}
                {item.status === "uploading" && "Editing & uploading…"}
                {item.status === "failed" && (item.lastError ? `Failed — will retry (${item.lastError})` : "Failed — will retry")}
                {item.status === "stuck" && (item.lastError ? `Can't upload — ${item.lastError}` : "Can't upload — giving up")}
              </div>
            </div>
            {item.status === "uploading" ? (
              <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d68a3c" strokeWidth={2.6} strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-9-9" />
              </svg>
            ) : (
              <span className={`h-2 w-2 flex-shrink-0 rounded-full ${item.status === "failed" || item.status === "stuck" ? "bg-red-400" : "bg-text-dim-2"}`} />
            )}
            <button
              onClick={() => onCancel(item.id)}
              aria-label={`Cancel upload of ${item.fileName}`}
              className="flex-shrink-0 rounded-full p-1 text-text-dim-2 hover:text-red-400"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="mt-auto grid grid-cols-3 gap-2.5 px-5 pb-8">
        <Stat label="shots today" value={shotsToday} />
        <Stat label="live on gallery" value={liveCount ?? 0} accent="success" />
        <Stat label="in queue" value={pendingCount} accent="gold" />
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: "gold" | "success" }) {
  return (
    <div className="rounded bg-panel py-3 text-center">
      <div
        className="font-display text-xl font-bold"
        style={{ color: accent === "gold" ? "#d68a3c" : accent === "success" ? "#4ade80" : undefined }}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10.5px] text-text-dim">{label}</div>
    </div>
  );
}
