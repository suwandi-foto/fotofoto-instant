import { notFound, redirect } from "next/navigation";
import { getEventBySlug, getPhoto, listVideoNotes, getOrCreateVideoReview } from "@/lib/queries";
import { getCurrentClient } from "@/lib/session";
import { VideoReviewView } from "./VideoReviewView";

export const dynamic = "force-dynamic";

/**
 * Video Review — timestamped notes, approve/revise. Behind the client
 * login, same as Photo Detail. NOTE: this app has no real video
 * transcoding/watermarking pipeline yet (flagged in the delivery brief
 * as the biggest remaining engineering lift), so `photo.previewPath`
 * is never actually set on a video row — the player below points at
 * the real intended URL (/api/videos/[id]/preview) and falls back to a
 * static placeholder when it can't load, rather than blocking this
 * screen's data model/UI on that pipeline landing first.
 */
export default async function VideoReviewPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;

  const session = await getCurrentClient();
  if (!session) redirect("/login");

  const event = await getEventBySlug(slug);
  if (!event) notFound();
  // Being logged in only proves *a* client's identity, not that this
  // client owns *this* event — without this check, any logged-in
  // client could reach and annotate another client's video by
  // guessing/copying a slug+id (see the client-scoping pass this
  // page's queries were audited under). An event with no linked client
  // (clientId null — guest/QR-only) has no legitimate owner here
  // either, so it 404s the same way.
  if (event.clientId !== session.clientId) notFound();

  const photo = await getPhoto(id);
  if (!photo || photo.eventId !== event.id || photo.kind !== "video") notFound();

  const [noteRows, review] = await Promise.all([
    listVideoNotes(id),
    getOrCreateVideoReview(id),
  ]);

  const notes = noteRows.map((row) => ({
    id: row.id,
    timestampSeconds: row.timestampSeconds,
    note: row.note,
  }));

  return (
    <VideoReviewView
      eventSlug={slug}
      eventName={event.name}
      videoId={id}
      previewUrl={`/api/videos/${id}/preview`}
      initialNotes={notes}
      initialStatus={review.status}
      initialDecidedAt={review.decidedAt}
    />
  );
}
