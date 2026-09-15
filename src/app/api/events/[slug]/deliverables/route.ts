import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEventBySlug, listEventDeliverables, createDeliverable } from "@/lib/queries";
import { tierEnum } from "@/db/schema";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const deliverables = await listEventDeliverables(event.id);
  return NextResponse.json({
    deliverables: deliverables.map((d) => ({
      id: d.id,
      name: d.name,
      tier: d.tier,
      quota: d.quota,
      status: d.status,
      createdAt: d.createdAt,
    })),
  });
}

const CreateDeliverableSchema = z.object({
  name: z.string().min(1),
  tier: z.enum(tierEnum),
  quota: z.number().int().positive().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const parsed = CreateDeliverableSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const deliverable = await createDeliverable(event.id, parsed.data);
  return NextResponse.json({ deliverable }, { status: 201 });
}
