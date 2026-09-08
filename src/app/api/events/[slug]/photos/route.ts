import { NextRequest, NextResponse } from "next/server";
import { getEventBySlug, listEventPhotos } from "@/lib/queries";

/**
 * GET: the gallery's polling endpoint. Deliberately returns only
 * preview URLs (never original paths) — full-res is reachable solely
 * through /api/photos/[id]/download, which requires an explicit
 * download action from the viewer.
 *
 * Uploading is a two-step flow — see POST /api/events/[slug]/photos/init
 * and /api/events/[slug]/photos/complete — rather than a single POST
 * here, so the raw photo bytes go straight from the phone to Drive
 * instead of through this server (see init's doc comment for why).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const photos = await listEventPhotos(event.id);
  return NextResponse.json({
    photos: photos.map((p) => ({
      id: p.id,
      previewUrl: `/api/photos/${p.id}/preview`,
      downloadUrl: `/api/photos/${p.id}/download`,
      orientation: p.orientation,
      uploadedAt: p.uploadedAt,
    })),
  });
}
