"use client";

import { useState } from "react";
import Link from "next/link";

type EventRow = {
  id: string;
  slug: string;
  name: string;
  tier: string;
  quota: number;
  archived: boolean;
};

/**
 * "Recent" is every non-archived event; "All" adds the archived ones
 * back in with their badge — matches design-reference/Main.dc.html's
 * Recent/All tabs, but driven by the actual archive rule instead of
 * that mockup's fixed placeholder slice.
 */
export function EventLibrary({ events }: { events: EventRow[] }) {
  const [tab, setTab] = useState<"recent" | "all">("recent");
  const recent = events.filter((e) => !e.archived);
  const visible = tab === "recent" ? recent : events;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-base font-semibold">Your library</h2>
          <p className="mt-0.5 text-xs text-text-dim-2">
            Archives after 2 weeks — always still viewable
          </p>
        </div>
        <div className="flex flex-shrink-0 rounded-lg border border-border bg-panel p-0.5">
          <button
            type="button"
            onClick={() => setTab("recent")}
            className={`rounded-md px-3 py-1.5 text-xs font-bold ${
              tab === "recent" ? "bg-gold text-gold-ink" : "text-text-dim"
            }`}
          >
            Recent
          </button>
          <button
            type="button"
            onClick={() => setTab("all")}
            className={`rounded-md px-3 py-1.5 text-xs font-bold ${
              tab === "all" ? "bg-gold text-gold-ink" : "text-text-dim"
            }`}
          >
            All
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-text-dim-2">
          {tab === "recent" ? "No recent events — check the All tab." : "No events linked to your account yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {visible.map((e) => (
            <li key={e.id}>
              <Link
                href={`/e/${e.slug}`}
                className="flex items-center gap-3 rounded-2xl border border-border bg-panel p-3 hover:border-gold"
              >
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gold text-gold-ink">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="18" height="14" rx="3" />
                    <circle cx="9" cy="10.5" r="1.6" />
                    <path d="m21 16-5.5-5-5 5" />
                  </svg>
                </div>
                <div className="min-w-0 flex-grow">
                  <div className="truncate text-sm font-semibold">{e.name}</div>
                  <div className="mt-0.5 text-xs text-text-dim">
                    {e.tier === "full_access" ? "Full access" : `Select · quota ${e.quota}`}
                  </div>
                </div>
                {e.archived && (
                  <span className="flex-shrink-0 rounded-full bg-panel-2 px-2 py-1 text-[9px] font-bold tracking-wide text-text-dim-2">
                    ARCHIVED
                  </span>
                )}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-text-dim-2">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
