import { notFound, redirect } from "next/navigation";
import { getEventBySlug, getPhoto, listVideoNotes, getOrCreateVideoReview } from "@/lib/queries";
import { getCurrentContact, formatAuthorName } from "@/lib/session";
import { VideoReviewView } from "./VideoReviewView";

export const dynamic = "force-dynamic";

/**
 * Video Review — timestamped notes, approve/revise. Behind the
 * client-contact login, same as Photo Detail. NOTE: this app has no
 * real video transcoding/watermarking pipeline yet (flagged in the
 * delivery brief as the biggest remaining engineering lift), so
 * `photo.previewPath` is never actually set on a video row — the
 * player below points at the real intended URL
 * (/api/videos/[id]/preview) and falls back to a static placeholder
 * when it can't load, rather than blocking this screen's data
 * model/UI on that pipeline landing first.
 */
export default async function VideoReviewPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;

  const contact = await getCurrentContact();
  if (!contact) redirect("/login");

  const event = await getEventBySlug(slug);
  if (!event) notFound();

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
    author: formatAuthorName(row.contactId, row.contact.name, contact.contactId),
  }));

  const decidedByName = review.decidedBy
    ? formatAuthorName(review.decidedBy.id, review.decidedBy.name, contact.contactId)
    : null;

  return (
    <VideoReviewView
      eventSlug={slug}
      eventName={event.name}
      videoId={id}
      previewUrl={`/api/videos/${id}/preview`}
      initialNotes={notes}
      initialStatus={review.status}
      initialDecidedByName={decidedByName}
    />
  );
}
