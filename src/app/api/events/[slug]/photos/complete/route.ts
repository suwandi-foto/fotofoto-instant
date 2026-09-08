import { NextRequest, NextResponse, after } from "next/server";
import {
  getEventBySlug,
  createQueuedPhoto,
  markPhotoLive,
  markPhotoFailed,
  getCustomPreset,
} from "@/lib/queries";
import { processCapturedPhoto, type PresetSpec, type ColorStats } from "@/lib/image";
import { getObject, putObject, deleteObject, originalKey, previewKey } from "@/lib/storage";
import { presetEnum } from "@/db/schema";
import { parseCustomPresetRef } from "@/lib/presetMeta";

async function resolvePresetSpec(
  eventId: string,
  presetRaw: string
): Promise<{ spec: PresetSpec } | { error: string }> {
  const customId = parseCustomPresetRef(presetRaw);
  if (customId) {
    const custom = await getCustomPreset(customId);
    if (!custom || custom.eventId !== eventId) {
      return { error: `Unknown custom preset '${presetRaw}'.` };
    }
    const stats: ColorStats = { mean: JSON.parse(custom.statsMean), std: JSON.parse(custom.statsStd) };
    return { spec: { kind: "custom", stats } };
  }
  const builtin = presetEnum.find((p) => p === presetRaw);
  if (!builtin) {
    return { error: `Missing/invalid 'preset' field. Expected one of: ${presetEnum.join(", ")}, or a custom:<id>.` };
  }
  return { spec: { kind: "builtin", id: builtin } };
}

/**
 * POST: step 2 of a photo upload, called once the phone's direct PUT
 * to the Drive session from POST .../photos/init has finished. Pulls
 * the raw bytes back down from Drive (an outbound fetch by our own
 * server, not an inbound request body, so it isn't subject to
 * Vercel's ~4.5MB body cap), applies the preset, and publishes the
 * photo exactly as the old single-request upload used to.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const presetRaw = typeof body?.preset === "string" ? body.preset : "";
  const rawKey = typeof body?.rawKey === "string" ? body.rawKey : "";
  if (!rawKey) return NextResponse.json({ error: "Missing 'rawKey' field" }, { status: 400 });

  const resolved = await resolvePresetSpec(event.id, presetRaw);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  const photoId = await createQueuedPhoto(event.id, presetRaw);

  try {
    const raw = await getObject(rawKey);
    if (raw.length === 0) {
      return NextResponse.json(
        { error: "The uploaded photo file is empty (0 bytes) — capture may have failed." },
        { status: 400 }
      );
    }

    const watermark = event.tier === "select";
    const processed = await processCapturedPhoto(raw, resolved.spec, watermark);

    const oKey = originalKey(event.id, photoId);
    const pKey = previewKey(event.id, photoId);
    await putObject(oKey, processed.original);
    await putObject(pKey, processed.preview);

    await markPhotoLive(photoId, {
      originalPath: oKey,
      previewPath: pKey,
      width: processed.width,
      height: processed.height,
      orientation: processed.orientation,
    });

    // Runs after the response is sent, but Vercel still keeps the
    // function alive until it finishes — a bare unawaited call here
    // could get frozen mid-flight the moment the response goes out.
    after(() => deleteObject(rawKey));

    return NextResponse.json(
      {
        photo: {
          id: photoId,
          status: "live",
          previewUrl: `/api/photos/${photoId}/preview`,
          downloadUrl: `/api/photos/${photoId}/download`,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    await markPhotoFailed(photoId);
    console.error("Photo processing failed", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
