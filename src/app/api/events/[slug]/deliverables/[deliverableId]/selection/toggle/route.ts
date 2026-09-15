import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEventBySlug, getDeliverable, toggleSelectionItem, getSelectionForDeliverable } from "@/lib/queries";

const Body = z.object({ photoId: z.string().min(1) });

export async function POST(
  req: NextRequest,
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
    return NextResponse.json({ error: "This deliverable is full-access; nothing to select." }, { status: 400 });
  }

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "photoId required" }, { status: 400 });

  try {
    const result = await toggleSelectionItem(deliverable.id, body.data.photoId);
    const selection = await getSelectionForDeliverable(deliverable.id);
    return NextResponse.json({
      selected: result.selected,
      selectedCount: selection?.items.length ?? 0,
      quota: deliverable.quota,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
