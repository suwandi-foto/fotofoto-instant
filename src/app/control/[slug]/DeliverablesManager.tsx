"use client";

import { useCallback, useEffect, useState } from "react";

type Tier = "full_access" | "select";
type Status = "in_progress" | "ready" | "delivered";
type Deliverable = { id: string; name: string; tier: Tier; quota: number; status: Status; createdAt: string };

const STATUS_LABEL: Record<Status, string> = {
  in_progress: "In progress",
  ready: "Ready",
  delivered: "Delivered",
};

export function DeliverablesManager({ slug }: { slug: string }) {
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tier>("full_access");
  const [quota, setQuota] = useState(20);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${slug}/deliverables`, { cache: "no-store" });
    if (res.ok) setDeliverables((await res.json()).deliverables);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function createDeliverable(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${slug}/deliverables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, tier, quota: tier === "select" ? quota : undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not create deliverable");
      setName("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(id: string, status: Status) {
    setError(null);
    setDeliverables((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)));
    try {
      const res = await fetch(`/api/events/${slug}/deliverables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update status");
    } catch (err) {
      setError((err as Error).message);
      refresh();
    }
  }

  async function remove(id: string, deliverableName: string) {
    if (
      !window.confirm(
        `Delete "${deliverableName}"? This permanently removes every photo/video in it — this can't be undone.`
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/events/${slug}/deliverables/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not delete deliverable");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) return <p className="text-sm text-text-dim-2">Loading deliverables…</p>;

  return (
    <section className="rounded-md border border-border bg-panel p-6">
      <h2 className="font-display text-lg font-semibold">Deliverables</h2>
      <p className="mt-1 text-sm text-text-dim">
        Independent galleries within this event — e.g. a full-access &quot;Normal Edit&quot; and a
        select-tier &quot;HQ Edit&quot; living side by side, each with its own tier and quota.
      </p>

      {deliverables.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2.5">
          {deliverables.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-border p-3"
            >
              <div>
                <div className="font-semibold">{d.name}</div>
                <div className="text-xs text-text-dim">
                  {d.tier === "select" ? `Select · quota ${d.quota}` : "Full access"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={d.status}
                  onChange={(e) => setStatus(d.id, e.target.value as Status)}
                  className="rounded-sm border border-border bg-panel-2 px-2 py-1 text-xs text-text outline-none focus:border-gold"
                >
                  {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => remove(d.id, d.name)}
                  className="text-xs text-red-400 hover:underline"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={createDeliverable} className="mt-5 flex flex-wrap items-end gap-3 border-t border-border pt-5">
        <label className="flex flex-col gap-1 text-sm text-text-dim">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Normal Edit"
            required
            className="rounded-sm border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-dim">
          Tier
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as Tier)}
            className="rounded-sm border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
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
              className="w-24 rounded-sm border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
            />
          </label>
        )}
        <button
          type="submit"
          disabled={creating}
          className="rounded-sm bg-gold px-4 py-2 font-semibold text-gold-ink hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "Adding…" : "Add deliverable"}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}
