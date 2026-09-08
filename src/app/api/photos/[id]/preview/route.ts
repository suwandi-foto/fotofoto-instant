import { NextRequest, NextResponse } from "next/server";
import { getPhoto } from "@/lib/queries";
import { getObject } from "@/lib/storage";

// The only image bytes a gallery page ever requests. Small WebP file,
// watermarked already if the event is select-tier (baked in at
// processing time, not applied on the fly here).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo || !photo.previewPath) {
    return NextResponse.json({ error: "Preview not available" }, { status: 404 });
  }
  const bytes = await getObject(photo.previewPath);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
