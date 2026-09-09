import { NextRequest, NextResponse } from "next/server";
import { getEventBySlug, getCustomPreset } from "@/lib/queries";
import { createResumableUploadSession, rawUploadKey } from "@/lib/storage";
import { presetEnum } from "@/db/schema";
import { parseCustomPresetRef } from "@/lib/presetMeta";
import { generateId } from "@/lib/ids";
import { isVideoContentType } from "@/lib/video";

/**
 * POST: step 1 of a photo upload. Validates the preset and opens a
 * resumable/session-based upload on the active storage backend (Drive
 * or R2 — see createResumableUploadSession in storage.ts; local disk
 * doesn't support this and throws). The phone then sends the photo to
 * POST /api/events/[slug]/photos/chunk in same-origin pieces (small
 * enough to stay under a typical host's request-body cap, which real
 * camera photos routinely exceed) — that route relays each chunk to
 * the `uploadUrl` this one returns. Once every chunk is sent, the
 * client calls POST /api/events/[slug]/photos/complete with the
 * returned `rawKey` to have the server pull the assembled file back
 * from storage, apply the preset, and publish the photo.
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
  const contentType = typeof body?.contentType === "string" && body.contentType ? body.contentType : "image/jpeg";

  // Presets are a photo-only concept (color grading) — a video upload
  // skips this validation entirely rather than being forced to supply
  // a meaningless one.
  if (!isVideoContentType(contentType)) {
    const customId = parseCustomPresetRef(presetRaw);
    if (customId) {
      const custom = await getCustomPreset(customId);
      if (!custom || custom.eventId !== event.id) {
        return NextResponse.json({ error: `Unknown custom preset '${presetRaw}'.` }, { status: 400 });
      }
    } else if (!presetEnum.find((p) => p === presetRaw)) {
      return NextResponse.json(
        { error: `Missing/invalid 'preset' field. Expected one of: ${presetEnum.join(", ")}, or a custom:<id>.` },
        { status: 400 }
      );
    }
  }

  const rawKey = rawUploadKey(event.id, generateId());

  try {
    const uploadUrl = await createResumableUploadSession(rawKey, contentType);
    return NextResponse.json({ uploadUrl, rawKey });
  } catch (err) {
    console.error("Could not start an upload session", err);
    return NextResponse.json({ error: "Could not start the upload" }, { status: 500 });
  }
}
