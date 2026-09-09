"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-gold disabled:opacity-50"
    >
      {busy ? "Logging out…" : "Log out"}
    </button>
  );
}
