import { notFound, redirect } from "next/navigation";
import {
  getEventBySlug,
  getPhoto,
  listEventPhotos,
  listPhotoAnnotations,
  getPhotoReactionSummary,
} from "@/lib/queries";
import { getCurrentClient } from "@/lib/session";
import { PhotoDetailView } from "./PhotoDetailView";

export const dynamic = "force-dynamic";

/**
 * Photo Detail — pin annotations, reactions, share. Behind the client
 * login from Prompt 01 even though the guest gallery itself isn't.
 */
export default async function PhotoDetailPage({
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
  // client owns *this* event — see the matching check on Video
  // Review's page.tsx for the full rationale.
  if (event.clientId !== session.clientId) notFound();

  const photo = await getPhoto(id);
  if (!photo || photo.eventId !== event.id) notFound();

  const [livePhotos, annotationRows, reactionSummary] = await Promise.all([
    listEventPhotos(event.id),
    listPhotoAnnotations(id),
    getPhotoReactionSummary(id, session.clientId),
  ]);

  const index = livePhotos.findIndex((p) => p.id === id);
  const position = index >= 0 ? index + 1 : 1;

  const annotations = annotationRows.map((row, i) => ({
    id: row.id,
    number: i + 1,
    xPct: row.xPct,
    yPct: row.yPct,
    note: row.note,
  }));

  return (
    <PhotoDetailView
      eventSlug={slug}
      eventName={event.name}
      photoId={id}
      previewUrl={`/api/photos/${id}/preview`}
      position={position}
      total={livePhotos.length}
      initialAnnotations={annotations}
      initialLiked={reactionSummary.liked}
      initialLikeCount={reactionSummary.count}
    />
  );
}
