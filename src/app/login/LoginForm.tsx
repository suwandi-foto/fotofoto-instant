"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [accessCode, setAccessCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "That code isn't valid.");
      router.push("/library");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-text-dim">
        Access code
        <input
          required
          type="text"
          value={accessCode}
          onChange={(e) => setAccessCode(e.target.value)}
          placeholder="7K9XQPM"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          className="rounded-lg border border-border bg-panel-2 px-3 py-2 uppercase tracking-widest text-text outline-none focus:border-gold"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="w-fit rounded-sm bg-gold px-4 py-2 font-semibold text-gold-ink hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Log in"}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
