import { NextRequest, NextResponse } from "next/server";
import { getEventBySlug, createCustomPreset } from "@/lib/queries";
import { computeColorStats } from "@/lib/image";
import { putObject, presetReferenceKey } from "@/lib/storage";
import { generateId } from "@/lib/ids";
import sharp from "sharp";

/**
 * POST: the Control Room's "upload a custom preset" action. The
 * studio uploads a reference photo whose color mood they want every
 * capture at this event to match; we store a small thumbnail of it
 * (for display) and its color statistics (for actually applying the
 * look — see computeColorStats / applyCustomPreset in image.ts).
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

  const file = form.get("image");
  const name = String(form.get("name") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'image' file field" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "The uploaded reference photo is empty (0 bytes)." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "A name is required for the preset." }, { status: 400 });
  }

  try {
    const raw = Buffer.from(await file.arrayBuffer());
    const stats = await computeColorStats(raw);
    const thumbnail = await sharp(raw)
      .rotate()
      .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const id = generateId();
    const key = presetReferenceKey(event.id, id);
    await putObject(key, thumbnail);
    await createCustomPreset(id, event.id, name, key, stats);

    return NextResponse.json(
      { preset: { id: `custom:${id}`, name, enabled: true, previewUrl: `/api/presets/${id}/preview` } },
      { status: 201 }
    );
  } catch (err) {
    console.error("Custom preset creation failed", err);
    return NextResponse.json({ error: "Could not process the reference photo" }, { status: 500 });
  }
}
