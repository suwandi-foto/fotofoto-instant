import { NextRequest, NextResponse, after } from "next/server";
import {
  getEventBySlug,
  getDeliverable,
  createQueuedPhoto,
  markPhotoLive,
  markPhotoProcessing,
  markPhotoFailed,
  getCustomPreset,
} from "@/lib/queries";
import { processCapturedPhoto, type PresetSpec, type ColorStats } from "@/lib/image";
import { isVideoContentType } from "@/lib/videoContentType";
import {
  getObject,
  putObject,
  deleteObject,
  originalKey,
  previewKey,
  videoOriginalKey,
  videoPreviewKey,
  videoThumbnailKey,
} from "@/lib/storage";
import { presetEnum, events, eventDeliverables } from "@/db/schema";
import { parseCustomPresetRef } from "@/lib/presetMeta";

type Event = typeof events.$inferSelect;
type Deliverable = typeof eventDeliverables.$inferSelect;

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

async function completePhoto(event: Event, deliverable: Deliverable, rawKey: string, presetRaw: string) {
  const resolved = await resolvePresetSpec(event.id, presetRaw);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  const photoId = await createQueuedPhoto(event.id, deliverable.id, presetRaw);

  try {
    const raw = await getObject(rawKey);
    if (raw.length === 0) {
      await markPhotoFailed(photoId);
      return NextResponse.json(
        { error: "The uploaded photo file is empty (0 bytes) — capture may have failed." },
        { status: 400 }
      );
    }

    // Per-deliverable now, not per-event — a full_access "Normal Edit"
    // and a select-tier "HQ Edit" can coexist in the same event.
    const watermark = deliverable.tier === "select";
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

/**
 * Video counterpart of completePhoto above. The entire pipeline —
 * probe, thumbnail extraction, storing the original, and the
 * transcode — runs via after(), not just the transcode. It used to
 * only defer the transcode and do probe+thumbnail+original-store
 * inline, on the theory that step was "the fast half"; in practice
 * that inline step still means downloading the full raw file back out
 * of storage and running ffprobe on it before responding at all, and
 * for a large file (a few hundred MB+) that alone was enough to blow
 * past the reverse proxy's timeout in front of Hostinger's persistent
 * Node process — killing the connection with a non-JSON error page
 * before the client ever saw a real response, which looked to the
 * photographer like the upload had silently failed. Responding the
 * instant the row exists, and doing every I/O- and CPU-heavy step in
 * the background, avoids that regardless of file size — same tradeoff
 * the transcode step already made (a failure here surfaces only as
 * the photo row flipping to "failed", not a client-visible error).
 */
async function completeVideo(event: Event, deliverable: Deliverable, rawKey: string) {
  // Loaded dynamically, and only here, so a plain photo upload (the
  // vastly more common case — see completePhoto above) never pays the
  // cost of loading @ffmpeg-installer/ffmpeg, and a host where that
  // binary fails to resolve only breaks video uploads, not every
  // upload — see videoContentType.ts's doc comment for the incident
  // that prompted this.
  const { extractVideoMeta, transcodeVideoPreview } = await import("@/lib/video");
  const photoId = await createQueuedPhoto(event.id, deliverable.id, "original", "video");

  after(async () => {
    try {
      const raw = await getObject(rawKey);
      if (raw.length === 0) {
        console.error(`Video ${photoId}: uploaded file is empty (0 bytes) — capture may have failed.`);
        await markPhotoFailed(photoId);
        return;
      }

      const meta = await extractVideoMeta(raw);

      const oKey = videoOriginalKey(event.id, photoId);
      const tKey = videoThumbnailKey(event.id, photoId);
      await putObject(oKey, raw);
      await putObject(tKey, meta.thumbnail);

      await markPhotoProcessing(photoId, {
        originalPath: oKey,
        thumbnailPath: tKey,
        width: meta.width,
        height: meta.height,
        orientation: meta.orientation,
      });

      try {
        const watermark = deliverable.tier === "select";
        const preview = await transcodeVideoPreview(raw, meta, watermark);
        const pKey = videoPreviewKey(event.id, photoId);
        await putObject(pKey, preview);
        await markPhotoLive(photoId, {
          originalPath: oKey,
          previewPath: pKey,
          width: meta.width,
          height: meta.height,
          orientation: meta.orientation,
          thumbnailPath: tKey,
        });
      } catch (err) {
        console.error("Video preview transcode failed", err);
        await markPhotoFailed(photoId);
      }
    } catch (err) {
      console.error("Video processing failed", err);
      await markPhotoFailed(photoId);
    } finally {
      await deleteObject(rawKey).catch(() => {});
    }
  });

  return NextResponse.json(
    {
      photo: {
        id: photoId,
        status: "queued",
        thumbnailUrl: `/api/photos/${photoId}/thumbnail`,
        videoReviewUrl: `/e/${event.slug}/video/${photoId}`,
      },
    },
    { status: 201 }
  );
}

/**
 * POST: step 2 of an upload, called once every chunk from POST
 * .../photos/chunk has been relayed to the session opened by POST
 * .../photos/init. Pulls the raw bytes back out of storage (an
 * outbound read by our own server, not an inbound request body, so
 * it isn't subject to any host's request-body cap), branches on
 * contentType (see photos/init's matching branch) to either the photo
 * or video pipeline, and publishes the result.
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
  const contentType = typeof body?.contentType === "string" ? body.contentType : "";
  const deliverableId = typeof body?.deliverableId === "string" ? body.deliverableId : "";
  if (!rawKey) return NextResponse.json({ error: "Missing 'rawKey' field" }, { status: 400 });

  const deliverable = deliverableId ? await getDeliverable(deliverableId) : null;
  if (!deliverable || deliverable.eventId !== event.id) {
    return NextResponse.json({ error: "Missing/invalid 'deliverableId' field." }, { status: 400 });
  }

  if (isVideoContentType(contentType)) {
    return completeVideo(event, deliverable, rawKey);
  }
  return completePhoto(event, deliverable, rawKey, presetRaw);
}
