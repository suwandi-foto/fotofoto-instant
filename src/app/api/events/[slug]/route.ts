import { NextRequest, NextResponse } from "next/server";
import { getEventBySlug, deleteEvent } from "@/lib/queries";
import { deleteEventObjects } from "@/lib/storage";

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
