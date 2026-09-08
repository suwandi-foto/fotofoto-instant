import { NextRequest, NextResponse } from "next/server";
import { getEventBySlug, getSelectionForEvent, finalizeSelection } from "@/lib/queries";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.tier !== "select") {
    return NextResponse.json({ error: "This event is full-access; nothing to finalize." }, { status: 400 });
  }

  const selection = await getSelectionForEvent(event.id);
  if (!selection) return NextResponse.json({ error: "No selection found" }, { status: 404 });
  if (selection.items.length === 0) {
    return NextResponse.json({ error: "Select at least one photo before finalizing." }, { status: 400 });
  }

  await finalizeSelection(event.id);
  const extraCount = Math.max(0, selection.items.length - event.quota);

  return NextResponse.json({
    finalized: true,
    selectedCount: selection.items.length,
    quota: event.quota,
    extraCount,
  });
}
