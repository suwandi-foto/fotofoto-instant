import { NextRequest, NextResponse } from "next/server";
import { getEventBySlug } from "@/lib/queries";
import { uploadChunk } from "@/lib/storage";

/**
 * POST: relays one same-origin chunk of a photo upload to the Drive
 * session opened by POST /api/events/[slug]/photos/init. Kept
 * same-origin deliberately — see init's doc comment — rather than
 * having the browser PUT to Drive directly, and kept small
 * deliberately — a few MB per chunk — to stay under Vercel's ~4.5MB
 * request body cap.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });

  const uploadUrl = form.get("uploadUrl");
  const startRaw = form.get("start");
  const totalRaw = form.get("total");
  const chunkFile = form.get("chunk");

  if (typeof uploadUrl !== "string" || !uploadUrl) {
    return NextResponse.json({ error: "Missing 'uploadUrl' field" }, { status: 400 });
  }
  if (!(chunkFile instanceof File)) {
    return NextResponse.json({ error: "Missing 'chunk' file field" }, { status: 400 });
  }
  const start = Number(startRaw);
  const total = Number(totalRaw);
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(total) || total <= 0) {
    return NextResponse.json({ error: "Missing/invalid 'start' or 'total' field" }, { status: 400 });
  }

  try {
    const chunkBuf = Buffer.from(await chunkFile.arrayBuffer());
    const result = await uploadChunk(uploadUrl, chunkBuf, start, total);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Chunk relay to Drive failed", err);
    return NextResponse.json({ error: "Could not upload this chunk" }, { status: 500 });
  }
}
