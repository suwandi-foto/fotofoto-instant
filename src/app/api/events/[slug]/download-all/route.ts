import { NextRequest, NextResponse } from "next/server";
import { ZipArchive } from "archiver";
import { PassThrough, Readable } from "node:stream";
import { getEventBySlug, listEventPhotos, getSelectionForEvent } from "@/lib/queries";
import { getObject } from "@/lib/storage";

/**
 * "Download All" — server-side zip, streamed as it's built rather
 * than assembled in memory first. Flagged in the brief as an
 * implementation detail worth revisiting (a queue-based background
 * zip job would scale better for very large events); this streaming
 * approach is a reasonable, real starting point for v1.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const allPhotos = await listEventPhotos(event.id);

  let downloadable = allPhotos;
  if (event.tier === "select") {
    const selection = await getSelectionForEvent(event.id);
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

  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="fotofoto-${event.slug}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
