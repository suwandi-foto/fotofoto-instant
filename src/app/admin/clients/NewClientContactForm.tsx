"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RelationshipStage = "foundation" | "growth_partner" | "enterprise";

type CreatedContact = {
  name: string;
  accessCode: string;
  companyName: string;
};

export function NewClientContactForm({
  clients,
}: {
  clients: { id: string; companyName: string }[];
}) {
  const router = useRouter();
  const [clientMode, setClientMode] = useState<"new" | "existing">(clients.length > 0 ? "existing" : "new");
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [companyName, setCompanyName] = useState("");
  const [relationshipStage, setRelationshipStage] = useState<RelationshipStage>("foundation");
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedContact | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const selectedCompanyName =
        clientMode === "existing" ? clients.find((c) => c.id === clientId)?.companyName ?? "" : companyName;

      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(clientMode === "existing" ? { clientId } : { companyName }),
          relationshipStage,
          name,
          department,
          email,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create contact");

      setCreated({ name: data.contact.name, accessCode: data.contact.accessCode, companyName: selectedCompanyName });
      setName("");
      setDepartment("");
      setEmail("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.accessCode);
      setCopied(true);
    } catch {
      // Clipboard access can fail (permissions, insecure context) —
      // the code is already shown on screen, so this is a nice-to-have.
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {created && (
        <div className="rounded-2xl border border-gold/40 bg-gold/10 p-4">
          <p className="text-sm text-text-dim">
            {created.name} at {created.companyName} — access code:
          </p>
          <div className="mt-2 flex items-center gap-3">
            <span className="font-display text-2xl font-bold tracking-[0.2em] text-gold">
              {created.accessCode}
            </span>
            <button
              type="button"
              onClick={copyCode}
              className="rounded-md border border-border bg-panel-2 px-2.5 py-1 text-xs font-bold text-text hover:border-gold"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-xs text-text-dim-2">
            Send this to the client — it works repeatedly until you create them a new one.
          </p>
        </div>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-2xl border border-border bg-panel p-4">
        <div className="flex gap-4 text-sm text-text-dim">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={clientMode === "existing"}
              onChange={() => setClientMode("existing")}
              disabled={clients.length === 0}
            />
            Existing client
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={clientMode === "new"} onChange={() => setClientMode("new")} />
            New client
          </label>
        </div>

        {clientMode === "existing" ? (
          <label className="flex flex-col gap-1 text-sm text-text-dim">
            Client
            <select
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
            >
              {clients.length === 0 && <option value="">No existing clients yet</option>}
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-sm text-text-dim">
            Company name
            <input
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="PT Nusantara Digital"
              className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
            />
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm text-text-dim">
          Relationship stage
          <select
            value={relationshipStage}
            onChange={(e) => setRelationshipStage(e.target.value as RelationshipStage)}
            className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
          >
            <option value="foundation">Foundation</option>
            <option value="growth_partner">Growth partner</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-text-dim">
            Contact name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sarah Wijaya"
              className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-text-dim">
            Department
            <input
              required
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="Marketing"
              className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm text-text-dim">
          Email (for records — not used for login)
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="sarah@client.com"
            className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-gold"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy || (clientMode === "existing" && !clientId)}
          className="w-fit rounded-sm bg-gold px-4 py-2 font-semibold text-gold-ink hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create contact + code"}
        </button>
      </form>
    </div>
  );
}
