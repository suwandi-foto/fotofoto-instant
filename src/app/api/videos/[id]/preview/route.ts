import { NextRequest, NextResponse } from "next/server";
import { getPhoto } from "@/lib/queries";
import { getObject } from "@/lib/storage";

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

/**
 * Serves the low-res/watermarked video preview — the video-pipeline
 * equivalent of /api/photos/[id]/preview. As of this route's addition
 * there is no real transcoding pipeline yet (see README.md), so
 * `previewPath` is never actually set on a video row and this always
 * 404s in practice; it's built against the real intended shape so
 * nothing else needs to change once that pipeline exists.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo || photo.kind !== "video" || !photo.previewPath) {
    return NextResponse.json({ error: "Video preview not available" }, { status: 404 });
  }
  const bytes = await getObject(photo.previewPath);
  const ext = photo.previewPath.split(".").pop()?.toLowerCase() ?? "";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "video/mp4",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
