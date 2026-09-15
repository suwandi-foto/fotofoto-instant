import { NextRequest, NextResponse } from "next/server";
import { ZipArchive } from "archiver";
import { PassThrough, Readable } from "node:stream";
import {
  getEventBySlug,
  getDeliverable,
  listDeliverablePhotos,
  getSelectionForDeliverable,
} from "@/lib/queries";
import { getObject } from "@/lib/storage";

/**
 * "Download All" — server-side zip, streamed as it's built rather
 * than assembled in memory first. Scoped to one deliverable, not the
 * whole event: once a full-access "Normal Edit" and a select-tier
 * "HQ Edit" can coexist in the same event, there's no single
 * event-wide "download all" gate that makes sense anymore — each
 * deliverable has its own.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; deliverableId: string }> }
) {
  const { slug, deliverableId } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const deliverable = await getDeliverable(deliverableId);
  if (!deliverable || deliverable.eventId !== event.id) {
    return NextResponse.json({ error: "Deliverable not found" }, { status: 404 });
  }

  const allPhotos = await listDeliverablePhotos(deliverable.id);

  let downloadable = allPhotos;
  if (deliverable.tier === "select") {
    const selection = await getSelectionForDeliverable(deliverable.id);
    if (!selection?.finalizedAt) {
      return NextResponse.json(
        { error: "Downloads unlock only after the selection is finalized." },
        { status: 403 }
      );
    }
    const selectedIds = new Set(selection.items.map((i) => i.photoId));
    downloadable = allPhotos.filter((p) => selectedIds.has(p.id));
  }

  if (downloadable.length === 0) {
    return NextResponse.json({ error: "No photos to download yet." }, { status: 404 });
  }

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const stream = new PassThrough();
  archive.pipe(stream);

  (async () => {
    for (const photo of downloadable) {
      if (!photo.originalPath) continue;
      const bytes = await getObject(photo.originalPath);
      archive.append(bytes, { name: `fotofoto-${photo.id}.jpg` });
    }
    await archive.finalize();
  })().catch((err) => {
    console.error("Zip build failed", err);
    stream.destroy(err as Error);
  });

  // deliverable.name is free-text staff input — strip it down to a
  // filename-safe slug before it goes anywhere near a header value.
  const safeName = deliverable.name.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "deliverable";

  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="fotofoto-${event.slug}-${safeName}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
