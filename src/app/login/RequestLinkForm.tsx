"use client";

import { useState } from "react";

export function RequestLinkForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setLoginUrl(null);
    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setMessage(data.message);
      setLoginUrl(data.loginUrl);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-text-dim">
        Email
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="sarah@client.com"
          className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="w-fit rounded-sm bg-gold px-4 py-2 font-semibold text-gold-ink hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send login link"}
      </button>

      {message && <p className="text-sm text-text-dim">{message}</p>}
      {loginUrl && (
        <p className="text-sm">
          Dev stand-in — no real email is sent yet, use the link directly:{" "}
          <a href={loginUrl} className="break-all text-gold underline">
            {loginUrl}
          </a>
        </p>
      )}
    </form>
  );
}
