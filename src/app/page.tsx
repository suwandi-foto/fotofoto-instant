import { db } from "@/db/client";
import { events as eventsTable } from "@/db/schema";
import { desc } from "drizzle-orm";
import Link from "next/link";
import { NewEventForm } from "./NewEventForm";
import { DeleteEventButton } from "./DeleteEventButton";
import { Logo } from "./Logo";
import { listClients, listEventDeliverables } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [events, clients] = await Promise.all([
    db.query.events.findMany({ orderBy: desc(eventsTable.createdAt) }),
    listClients(),
  ]);
  const clientNameById = new Map(clients.map((c) => [c.id, c.companyName]));
  const deliverablesByEvent = new Map(
    await Promise.all(
      events.map(async (e) => [e.id, await listEventDeliverables(e.id)] as const)
    )
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
      <div className="mb-10">
        <Logo className="text-sm tracking-wide" />
        <h1 className="font-display mt-3 text-3xl font-semibold">Instant Delivery — control room</h1>
        <p className="mt-2 text-sm text-text-dim">
          Create an event to get a QR/link for its gallery, and the shoot link the photographer's
          app uploads to. This is the working v1 build — no login anywhere, matching the confirmed
          design.
        </p>
      </div>

      <section className="mb-12 rounded-2xl border border-border bg-panel p-6">
        <h2 className="font-display text-lg font-semibold">New event</h2>
        <NewEventForm clients={clients.map((c) => ({ id: c.id, companyName: c.companyName }))} />
      </section>

      <section>
        <h2 className="font-display mb-4 text-lg font-semibold">Events</h2>
        {events.length === 0 ? (
          <p className="text-sm text-text-dim-2">No events yet — create one above.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-panel p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-display font-semibold">{e.name}</div>
                  <div className="text-sm text-text-dim">
                    {e.clientName} &middot;{" "}
                    <span className="text-gold">
                      {(() => {
                        const deliverables = deliverablesByEvent.get(e.id) ?? [];
                        if (deliverables.length === 0) return "No deliverables yet";
                        if (deliverables.length === 1) {
                          const d = deliverables[0];
                          return d.tier === "full_access" ? "Full access" : `Select (quota ${d.quota})`;
                        }
                        return `${deliverables.length} deliverables`;
                      })()}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-text-dim-2">
                    {e.clientId ? (
                      <>Linked to portal account: {clientNameById.get(e.clientId) ?? "unknown client"}</>
                    ) : (
                      "Not linked to a portal account — reachable only via its own link/QR"
                    )}
                  </div>
                </div>
                <div className="flex gap-2 text-sm">
                  <Link
                    href={`/e/${e.slug}`}
                    className="rounded-lg border border-border px-3 py-1.5 hover:border-gold"
                  >
                    Gallery
                  </Link>
                  <Link
                    href={`/shoot/${e.slug}`}
                    className="rounded-lg border border-border px-3 py-1.5 hover:border-gold"
                  >
                    Photographer app
                  </Link>
                  <Link
                    href={`/e/${e.slug}/qr`}
                    className="rounded-sm bg-gold px-3 py-1.5 font-semibold text-gold-ink hover:opacity-90"
                  >
                    QR
                  </Link>
                  <Link
                    href={`/control/${e.slug}`}
                    className="rounded-lg border border-border px-3 py-1.5 hover:border-gold"
                  >
                    Manage
                  </Link>
                  <DeleteEventButton slug={e.slug} eventName={e.name} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
