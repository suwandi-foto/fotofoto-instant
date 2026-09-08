import { NextRequest, NextResponse } from "next/server";
import { getEventBySlug, getSelectionForEvent, deleteEvent } from "@/lib/queries";
import { deleteEventObjects } from "@/lib/storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const selection =
    event.tier === "select" ? await getSelectionForEvent(event.id) : null;

  return NextResponse.json({
    event: {
      id: event.id,
      slug: event.slug,
      name: event.name,
      clientName: event.clientName,
      tier: event.tier,
      quota: event.quota,
      extraUnitNote: event.extraUnitNote,
    },
    selection: selection
      ? {
          finalized: Boolean(selection.finalizedAt),
          selectedPhotoIds: selection.items.map((i) => i.photoId),
        }
      : null,
  });
}

/**
 * DELETE: permanently removes an event from the Control Room —
 * photos, selection, and selection items cascade at the DB level;
 * storage objects (originals/previews/preset references) are cleaned
 * up here since they live outside the DB.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  await deleteEvent(event.id);
  await deleteEventObjects(event.id);

  return NextResponse.json({ ok: true });
}
