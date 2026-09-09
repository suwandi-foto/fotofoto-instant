import { NextRequest, NextResponse } from "next/server";
import { getEventBySlug, listEventVideos } from "@/lib/queries";

/**
 * GET: the gallery's video-section polling endpoint — kept separate
 * from GET .../photos (see listEventVideos's doc comment) so the
 * select-tier quota/selection logic there never has to account for
 * videos mixed into its counts.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const videos = await listEventVideos(event.id);
  return NextResponse.json({
    videos: videos.map((v) => ({
      id: v.id,
      thumbnailUrl: `/api/photos/${v.id}/thumbnail`,
      reviewUrl: `/e/${slug}/video/${v.id}`,
      orientation: v.orientation,
      uploadedAt: v.uploadedAt,
    })),
  });
}
