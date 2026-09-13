type DeliverableRow = {
  id: string;
  project: string;
  type: string;
  description: string;
  status: string;
};

/**
 * Expected deliverables ops pushed alongside this client's portal
 * access (see POST /api/ops/clients and clientDeliverables in
 * src/db/schema.ts) — grouped by project since one login here covers
 * every project a client has, not just one. Renders nothing at all
 * when the list is empty (a brand-new client ops hasn't attached any
 * deliverables to yet), rather than an empty-state card — there's
 * nothing actionable to tell them.
 */
export function DeliverablesSection({ deliverables }: { deliverables: DeliverableRow[] }) {
  if (deliverables.length === 0) return null;

  const byProject = new Map<string, DeliverableRow[]>();
  for (const d of deliverables) {
    const group = byProject.get(d.project);
    if (group) group.push(d);
    else byProject.set(d.project, [d]);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-base font-semibold">Deliverables</h2>
      <div className="flex flex-col gap-4">
        {[...byProject.entries()].map(([project, items]) => (
          <div key={project} className="flex flex-col gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-text-dim-2">{project}</h3>
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-panel p-3"
                >
                  <div className="min-w-0 flex-grow">
                    <div className="truncate text-sm font-semibold">{item.type}</div>
                    <div className="mt-0.5 truncate text-xs text-text-dim">{item.description}</div>
                  </div>
                  <span className="flex-shrink-0 rounded-full bg-panel-2 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-text-dim-2">
                    {item.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
