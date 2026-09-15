import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getEventBySlug,
  getDeliverable,
  updateDeliverable,
  deleteDeliverable,
  listAllDeliverablePhotos,
} from "@/lib/queries";
import { deleteObject } from "@/lib/storage";
import { tierEnum, deliverableStatusEnum } from "@/db/schema";

const PatchSchema = z.object({
  name: z.string().min(1).optional(),
  tier: z.enum(tierEnum).optional(),
  quota: z.number().int().min(0).optional(),
  status: z.enum(deliverableStatusEnum).optional(),
});

async function loadOwnedDeliverable(slug: string, deliverableId: string) {
  const event = await getEventBySlug(slug);
  if (!event) return { error: NextResponse.json({ error: "Event not found" }, { status: 404 }) } as const;
  const deliverable = await getDeliverable(deliverableId);
  if (!deliverable || deliverable.eventId !== event.id) {
    return { error: NextResponse.json({ error: "Deliverable not found" }, { status: 404 }) } as const;
  }
  return { event, deliverable } as const;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; deliverableId: string }> }
) {
  const { slug, deliverableId } = await params;
  const loaded = await loadOwnedDeliverable(slug, deliverableId);
  if ("error" in loaded) return loaded.error;

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await updateDeliverable(deliverableId, parsed.data);
  return NextResponse.json({ ok: true });
}

/**
 * DELETE: removes a deliverable and everything in it. Storage keys
 * are eventId-prefixed, not deliverable-prefixed (see
 * photos.deliverableId's schema comment), so — unlike deleting a
 * whole event — there's no single folder-prefix delete available
 * here; every one of this deliverable's photo/video objects has to be
 * looked up and removed individually before the DB row (and its
 * cascaded photos/selection) goes away.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; deliverableId: string }> }
) {
  const { slug, deliverableId } = await params;
  const loaded = await loadOwnedDeliverable(slug, deliverableId);
  if ("error" in loaded) return loaded.error;

  const rows = await listAllDeliverablePhotos(deliverableId);
  for (const row of rows) {
    if (row.originalPath) await deleteObject(row.originalPath);
    if (row.previewPath) await deleteObject(row.previewPath);
    if (row.thumbnailPath) await deleteObject(row.thumbnailPath);
  }

  await deleteDeliverable(deliverableId);
  return NextResponse.json({ ok: true });
}
