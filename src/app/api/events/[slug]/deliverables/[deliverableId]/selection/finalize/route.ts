import { NextRequest, NextResponse } from "next/server";
import { getEventBySlug, getDeliverable, getSelectionForDeliverable, finalizeSelection } from "@/lib/queries";

export async function POST(
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
  if (deliverable.tier !== "select") {
    return NextResponse.json({ error: "This deliverable is full-access; nothing to finalize." }, { status: 400 });
  }

  const selection = await getSelectionForDeliverable(deliverable.id);
  if (!selection) return NextResponse.json({ error: "No selection found" }, { status: 404 });
  if (selection.items.length === 0) {
    return NextResponse.json({ error: "Select at least one photo before finalizing." }, { status: 400 });
  }

  await finalizeSelection(deliverable.id);
  const extraCount = Math.max(0, selection.items.length - deliverable.quota);

  return NextResponse.json({
    finalized: true,
    selectedCount: selection.items.length,
    quota: deliverable.quota,
    extraCount,
  });
}
