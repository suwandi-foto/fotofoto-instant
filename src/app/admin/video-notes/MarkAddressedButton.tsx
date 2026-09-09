"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MarkAddressedButton({ noteId }: { noteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/video-notes/${noteId}/addressed`, { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex-shrink-0 rounded-md border border-border px-2.5 py-1.5 text-[10.5px] font-bold text-text-dim hover:border-gold hover:text-gold disabled:opacity-50"
    >
      {busy ? "…" : "Mark addressed"}
    </button>
  );
}
