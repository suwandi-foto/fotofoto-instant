import Link from "next/link";

type Deliverable = {
  id: string;
  name: string;
  tier: "full_access" | "select";
  quota: number;
  status: "in_progress" | "ready" | "delivered";
};

type EventGroup = {
  eventId: string;
  eventSlug: string;
  eventName: string;
  deliverables: Deliverable[];
};

const STATUS_LABEL: Record<Deliverable["status"], string> = {
  in_progress: "In progress",
  ready: "Ready",
  delivered: "Delivered",
};

/**
 * Real deliverables (see eventDeliverables in schema.ts), grouped by
 * event — replaces the old ops-pushed, free-text-only, unlinked
 * status list this component used to render (see git history /
 * clientDeliverables' schema comment for that). Each row now links
 * straight into its own tab of that event's gallery. Renders nothing
 * at all when the list is empty, same as before — there's nothing
 * actionable to tell them yet.
 */
export function DeliverablesSection({ events }: { events: EventGroup[] }) {
  const withDeliverables = events.filter((e) => e.deliverables.length > 0);
  if (withDeliverables.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-base font-semibold">Deliverables</h2>
      <div className="flex flex-col gap-4">
        {withDeliverables.map((group) => (
          <div key={group.eventId} className="flex flex-col gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-text-dim-2">
              {group.eventName}
            </h3>
            <ul className="flex flex-col gap-2">
              {group.deliverables.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/e/${group.eventSlug}?deliverable=${d.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-panel p-3 hover:border-gold"
                  >
                    <div className="min-w-0 flex-grow">
                      <div className="truncate text-sm font-semibold">{d.name}</div>
                      <div className="mt-0.5 truncate text-xs text-text-dim">
                        {d.tier === "select" ? `Select · quota ${d.quota}` : "Full access"}
                      </div>
                    </div>
                    <span className="flex-shrink-0 rounded-full bg-panel-2 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-text-dim-2">
                      {STATUS_LABEL[d.status]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
