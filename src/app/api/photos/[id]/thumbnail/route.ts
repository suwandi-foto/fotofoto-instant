import { NextRequest, NextResponse } from "next/server";
import { getPhoto } from "@/lib/queries";
import { getObject } from "@/lib/storage";

/** Serves a video's static grid-thumbnail frame (see schema.ts's
 * photos.thumbnailPath) — the video-kind counterpart of
 * /api/photos/[id]/preview, which serves a photo's WebP preview. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo || !photo.thumbnailPath) {
    return NextResponse.json({ error: "Thumbnail not available" }, { status: 404 });
  }
  const bytes = await getObject(photo.thumbnailPath);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
