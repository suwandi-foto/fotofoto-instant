"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteEventButton({ slug, eventName }: { slug: string; eventName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    const confirmed = window.confirm(
      `Delete "${eventName}"? This permanently removes its gallery, photos, and selection. This can't be undone.`
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/events/${slug}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to delete event");
      router.refresh();
    } catch (err) {
      window.alert((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-sm border border-border px-3 py-1.5 text-sm text-red-400 hover:border-red-400 disabled:opacity-50"
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
