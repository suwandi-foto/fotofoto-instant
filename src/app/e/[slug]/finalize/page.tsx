import { getEventBySlug, getSelectionForEvent } from "@/lib/queries";
import { db } from "@/db/client";
import { photos as photosTable } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/app/Logo";

export const dynamic = "force-dynamic";

export default async function FinalizePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();
  if (event.tier !== "select") redirect(`/e/${slug}`);

  const selection = await getSelectionForEvent(event.id);
  if (!selection || !selection.finalizedAt) redirect(`/e/${slug}`);

  const selectedIds = selection.items.map((i) => i.photoId);
  const selectedPhotos = selectedIds.length
    ? await db.query.photos.findMany({ where: inArray(photosTable.id, selectedIds) })
    : [];

  const total = selectedPhotos.length;
  const included = Math.min(total, event.quota);
  const extra = Math.max(0, total - event.quota);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b border-border px-5 pb-4 pt-6">
        <Link href="/">
          <Logo className="text-sm tracking-wide" />
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gold">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#191308" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <div>
            <div className="font-display text-lg font-semibold leading-tight">Selection finalized</div>
            <div className="text-sm text-text-dim">{event.name}</div>
          </div>
        </div>
      </div>

      <div className="m-5 flex flex-col gap-3 rounded-md bg-panel p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-dim">Included in package</span>
          <span className="font-display font-bold">
            {included} / {event.quota}
          </span>
        </div>
        <div className="h-px bg-border" />
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-dim">Extra photos selected</span>
          <span className="font-display font-bold text-gold">+{extra}</span>
        </div>
        {extra > 0 && <p className="text-xs text-text-dim-2">{event.extraUnitNote}</p>}
      </div>

      <div className="flex flex-col gap-2.5 px-5">
        <div className="text-xs font-bold uppercase tracking-wide text-text-dim">
          Your {total} photo{total === 1 ? "" : "s"}
        </div>
        <div className="masonry">
          {selectedPhotos.map((p) => (
            <div key={p.id} className="masonry-item overflow-hidden rounded-sm bg-panel-2" style={{ aspectRatio: p.orientation === "portrait" ? "3 / 4" : p.orientation === "landscape" ? "4 / 3" : "1 / 1" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/photos/${p.id}/preview`} alt="" className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      </div>

      <div className="m-5 flex items-center gap-2.5 rounded border border-gold/35 bg-gold-soft p-3.5">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d68a3c" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 9.9-1" />
        </svg>
        <p className="text-sm text-text">
          Full-resolution downloads are now unlocked for all {total} selected photos.
        </p>
      </div>

      <div className="flex-1" />
      <div className="px-5 pb-8">
        <a
          href={`/api/events/${slug}/download-all`}
          className="flex items-center justify-center gap-2 rounded-md bg-gold px-4 py-3.5 text-center font-bold text-gold-ink hover:opacity-90"
        >
          Download my {total} photos
        </a>
      </div>
    </main>
  );
}
