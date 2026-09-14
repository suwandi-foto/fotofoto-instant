"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewEventForm({ clients }: { clients: { id: string; companyName: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientId, setClientId] = useState("");
  const [tier, setTier] = useState<"full_access" | "select">("full_access");
  const [quota, setQuota] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          clientName,
          tier,
          quota: tier === "select" ? quota : undefined,
          clientId: clientId || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create event");
      router.refresh();
      setName("");
      setClientName("");
      setClientId("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-text-dim">
          Event name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Anugerah Manufaktur 2026"
            className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-dim">
          Client name
          <input
            required
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="PT Arezda Purnama Loka"
            className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm text-text-dim">
        Link to client portal account (optional)
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
        >
          <option value="">Not linked — only reachable via its own link/QR</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.companyName}
            </option>
          ))}
        </select>
        <span className="text-xs text-text-dim-2">
          When linked, this event shows up under that client&apos;s &quot;Your library&quot; at /library.
        </span>
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-text-dim">
          Tier (package chosen at booking)
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as "full_access" | "select")}
            className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
          >
            <option value="full_access">Full access</option>
            <option value="select">Select &amp; choose</option>
          </select>
        </label>

        {tier === "select" && (
          <label className="flex flex-col gap-1 text-sm text-text-dim">
            Quota
            <input
              type="number"
              min={1}
              value={quota}
              onChange={(e) => setQuota(Number(e.target.value))}
              className="w-24 rounded-lg border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
            />
          </label>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-sm bg-gold px-4 py-2 font-semibold text-gold-ink hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create event"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
