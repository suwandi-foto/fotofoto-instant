import { NextRequest, NextResponse } from "next/server";
import {
  getEventBySlug,
  listEventDeliverables,
  listDeliverablePhotos,
  listDeliverableVideos,
  getSelectionForDeliverable,
} from "@/lib/queries";

/**
 * GET: the gallery's single polling endpoint — one deliverable used to
 * be one event, so this used to be GET .../photos + GET .../videos +
 * GET .../ (for selection state). Now that one event can hold several
 * independently-tiered deliverables, returning them all in one shot
 * keeps the poll to one request regardless of how many deliverables an
 * event has, rather than ballooning into 2-3 requests per deliverable
 * every 4 seconds. Also backs ShootApp's "shots today" stat, which
 * only needs the photo/video counts, not the per-deliverable split.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const deliverableRows = await listEventDeliverables(event.id);

  const deliverables = await Promise.all(
    deliverableRows.map(async (d) => {
      const [photoRows, videoRows, selection] = await Promise.all([
        listDeliverablePhotos(d.id),
        listDeliverableVideos(d.id),
        d.tier === "select" ? getSelectionForDeliverable(d.id) : Promise.resolve(null),
      ]);

      return {
        id: d.id,
        name: d.name,
        tier: d.tier,
        quota: d.quota,
        extraUnitNote: d.extraUnitNote,
        status: d.status,
        photos: photoRows.map((p) => ({
          id: p.id,
          previewUrl: `/api/photos/${p.id}/preview`,
          downloadUrl: `/api/photos/${p.id}/download`,
          orientation: p.orientation,
          uploadedAt: p.uploadedAt,
        })),
        videos: videoRows.map((v) => ({
          id: v.id,
          thumbnailUrl: `/api/photos/${v.id}/thumbnail`,
          reviewUrl: `/e/${event.slug}/video/${v.id}`,
          orientation: v.orientation,
          uploadedAt: v.uploadedAt,
        })),
        selection: selection
          ? {
              finalized: Boolean(selection.finalizedAt),
              selectedPhotoIds: selection.items.map((i) => i.photoId),
            }
          : null,
      };
    })
  );

  return NextResponse.json({
    event: { name: event.name, clientName: event.clientName },
    deliverables,
  });
}
