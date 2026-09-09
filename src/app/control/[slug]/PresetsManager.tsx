"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseCustomPresetRef } from "@/lib/presetMeta";
import { ZoomableImage } from "./ZoomableImage";

type BuiltinPreset = { id: string; name: string; swatch: string; enabled: boolean };
type CustomPreset = { id: string; name: string; enabled: boolean; previewUrl: string };

export function PresetsManager({ slug }: { slug: string }) {
  const [builtins, setBuiltins] = useState<BuiltinPreset[]>([]);
  const [custom, setCustom] = useState<CustomPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [newName, setNewName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${slug}/presets`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setBuiltins(data.builtins);
      setCustom(data.custom);
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggleBuiltin(id: string, enabled: boolean) {
    setError(null);
    const nextEnabled = builtins.filter((b) => (b.id === id ? enabled : b.enabled)).map((b) => b.id);
    setBuiltins((prev) => prev.map((b) => (b.id === id ? { ...b, enabled } : b)));
    try {
      const res = await fetch(`/api/events/${slug}/presets`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledBuiltins: nextEnabled }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update preset");
    } catch (err) {
      setError((err as Error).message);
      refresh();
    }
  }

  async function toggleCustom(id: string, enabled: boolean) {
    setError(null);
    const dbId = parseCustomPresetRef(id);
    if (!dbId) return;
    setCustom((prev) => prev.map((c) => (c.id === id ? { ...c, enabled } : c)));
    try {
      const res = await fetch(`/api/events/${slug}/presets/custom/${dbId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update preset");
    } catch (err) {
      setError((err as Error).message);
      refresh();
    }
  }

  async function deleteCustom(id: string, name: string) {
    const dbId = parseCustomPresetRef(id);
    if (!dbId) return;
    if (!window.confirm(`Delete the custom preset "${name}"? Photos already taken with it keep their look.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/events/${slug}/presets/custom/${dbId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not delete preset");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function uploadCustom(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || !newName.trim()) return;

    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("name", newName.trim());
      const res = await fetch(`/api/events/${slug}/presets/custom`, { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not create preset");
      setNewName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <p className="text-sm text-text-dim-2">Loading presets…</p>;

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-md border border-border bg-panel p-6">
        <h2 className="font-display text-lg font-semibold">Built-in presets</h2>
        <p className="mt-1 text-sm text-text-dim">
          Choose which of these the photographer app offers for this event.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {builtins.map((b) => (
            <label
              key={b.id}
              className="flex cursor-pointer flex-col items-center gap-2 rounded border border-border p-3"
              style={{ opacity: b.enabled ? 1 : 0.45 }}
            >
              <div className="aspect-square w-full rounded-sm" style={{ background: b.swatch }} />
              <span className="text-center text-xs font-semibold">{b.name}</span>
              <input
                type="checkbox"
                checked={b.enabled}
                onChange={(e) => toggleBuiltin(b.id, e.target.checked)}
                className="accent-gold"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-border bg-panel p-6">
        <h2 className="font-display text-lg font-semibold">Custom presets</h2>
        <p className="mt-1 text-sm text-text-dim">
          Upload a reference photo whose color mood you want captures at this event to match. We
          match brightness and contrast per color channel to it — not a full LUT, but enough to give
          the photographer a look beyond the four built-ins.
        </p>

        {custom.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {custom.map((c) => (
              <div key={c.id} className="flex flex-col items-center gap-2 rounded border border-border p-3" style={{ opacity: c.enabled ? 1 : 0.45 }}>
                <ZoomableImage src={c.previewUrl} alt={c.name} className="aspect-square w-full rounded-sm object-cover" />
                <span className="text-center text-xs font-semibold">{c.name}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={(e) => toggleCustom(c.id, e.target.checked)}
                    className="accent-gold"
                  />
                  <button
                    type="button"
                    onClick={() => deleteCustom(c.id, c.name)}
                    className="text-xs text-red-400 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={uploadCustom} className="mt-5 flex flex-wrap items-end gap-3 border-t border-border pt-5">
          <label className="flex flex-col gap-1 text-sm text-text-dim">
            Preset name
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Client's mood board look"
              required
              className="rounded-sm border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-text-dim">
            Reference photo
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              required
              className="text-sm text-text-dim file:mr-3 file:rounded-sm file:border-0 file:bg-panel-2 file:px-3 file:py-2 file:text-text"
            />
          </label>
          <button
            type="submit"
            disabled={uploading}
            className="rounded-sm bg-gold px-4 py-2 font-semibold text-gold-ink hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload preset"}
          </button>
        </form>
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
