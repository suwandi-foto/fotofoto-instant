"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/app/Logo";
import { DeliverableGallerySection, type DeliverableGalleryState } from "./DeliverableGallerySection";

/**
 * Event-level shell: logo, event name, feedback entry point, and a
 * tab bar when the event has more than one deliverable (each its own
 * independently-tiered gallery — see DeliverableGallerySection). With
 * exactly one deliverable (every event before this feature, and most
 * after it) the tab bar is skipped entirely and that one deliverable
 * renders full-width, unchanged from how this page used to look when
 * "one event = one gallery" was the whole model.
 */
export function Gallery({
  slug,
  initialEvent,
}: {
  slug: string;
  initialEvent: { name: string; clientName: string };
}) {
  // Deep-link support for /library's Deliverables section
  // (?deliverable=<id>) — only consulted on first load (see refresh's
  // `prev` check below), so it never fights a tab the viewer has
  // since switched to on a later poll.
  const deliverableFromUrl = useSearchParams().get("deliverable");

  const [deliverables, setDeliverables] = useState<DeliverableGalleryState[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${slug}/gallery`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setDeliverables(data.deliverables);
    setLoaded(true);
    // Keep the current tab if it still exists; otherwise prefer the
    // ?deliverable= link target if it exists, else the first
    // deliverable (covers first load and a deliverable being removed
    // out from under an open tab).
    setActiveId((prev) => {
      if (prev && data.deliverables.some((d: DeliverableGalleryState) => d.id === prev)) return prev;
      if (deliverableFromUrl && data.deliverables.some((d: DeliverableGalleryState) => d.id === deliverableFromUrl)) {
        return deliverableFromUrl;
      }
      return data.deliverables[0]?.id ?? null;
    });
  }, [slug, deliverableFromUrl]);

  useEffect(() => {
    refresh();
    // Simple polling — matches the confirmed "live enough for event
    // pace" decision over building full websocket infrastructure.
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  const active = deliverables.find((d) => d.id === activeId) ?? null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-border px-5 pb-4 pt-6">
        <Link href="/">
          <Logo className="text-sm tracking-wide" />
        </Link>
        <h1 className="font-display text-2xl font-semibold leading-tight">{initialEvent.name}</h1>
      </div>

      {/* Feedback / NPS entry point */}
      <div className="px-5 pt-4">
        <Link
          href={`/e/${slug}/feedback`}
          className="flex items-center gap-3 rounded-2xl border border-border bg-panel p-3.5 hover:border-gold/50"
        >
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-gold-soft text-gold">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
            </svg>
          </div>
          <div className="flex-grow">
            <div className="text-[13px] font-bold">How was your last project?</div>
            <div className="mt-0.5 text-[11px] text-text-dim">20 seconds · refer a friend, get Rp500k credit</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim-2)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
      </div>

      {/* Deliverable tabs — only when there's more than one */}
      {deliverables.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-5 pt-4" style={{ scrollbarWidth: "none" }}>
          {deliverables.map((d) => (
            <button
              key={d.id}
              onClick={() => setActiveId(d.id)}
              className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold ${
                d.id === activeId ? "bg-gold text-gold-ink" : "border border-border bg-panel text-text-dim"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      {loaded && deliverables.length === 0 && (
        <p className="px-5 py-10 text-center text-sm text-text-dim-2">
          No deliverables yet — check back once the studio has set this event up.
        </p>
      )}

      {active && <DeliverableGallerySection slug={slug} deliverable={active} onChanged={refresh} />}
    </main>
  );
}
