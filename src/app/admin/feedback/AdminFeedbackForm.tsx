"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminFeedbackForm() {
  const router = useRouter();
  const [authorLabel, setAuthorLabel] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!authorLabel.trim() || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorLabel: authorLabel.trim(), text: text.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save note");
      setText("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-panel p-4">
      <input
        required
        type="text"
        value={authorLabel}
        onChange={(e) => setAuthorLabel(e.target.value)}
        placeholder="Your name"
        className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm text-text outline-none focus:border-gold"
      />
      <textarea
        required
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Note for the CEO…"
        rows={4}
        className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm text-text outline-none focus:border-gold"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-fit rounded-md bg-gold px-4 py-2 text-sm font-bold text-gold-ink hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Send to CEO"}
      </button>
    </form>
  );
}
