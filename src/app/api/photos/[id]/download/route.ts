import { NextRequest, NextResponse } from "next/server";
import { getPhoto } from "@/lib/queries";
import { getObject } from "@/lib/storage";
import { db } from "@/db/client";
import { eventDeliverables, selections, selectionItems } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * The only place full-resolution bytes are ever served. In production
 * this would issue a short-lived signed R2 URL instead of proxying
 * the file through the app server; the access rule below (gate by
 * tier + finalized selection) is what matters and carries over
 * unchanged either way.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo || !photo.originalPath || !photo.deliverableId) {
    return NextResponse.json({ error: "Photo not available" }, { status: 404 });
  }

  const deliverable = await db.query.eventDeliverables.findFirst({
    where: eq(eventDeliverables.id, photo.deliverableId),
  });
  if (!deliverable) return NextResponse.json({ error: "Deliverable not found" }, { status: 404 });

  if (deliverable.tier === "select") {
    const selection = await db.query.selections.findFirst({
      where: eq(selections.deliverableId, deliverable.id),
    });
    const isFinalized = Boolean(selection?.finalizedAt);
    const isSelected = selection
      ? Boolean(
          await db.query.selectionItems.findFirst({
            where: and(
              eq(selectionItems.selectionId, selection.id),
              eq(selectionItems.photoId, photo.id)
            ),
          })
        )
      : false;

    if (!isFinalized || !isSelected) {
      return NextResponse.json(
        { error: "Full-resolution download unlocks only after this photo is finalized in the selection." },
        { status: 403 }
      );
    }
  }

  const bytes = await getObject(photo.originalPath);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": `attachment; filename="fotofoto-${photo.id}.jpg"`,
      "Cache-Control": "private, no-store",
    },
  });
}
