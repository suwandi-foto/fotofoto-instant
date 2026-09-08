import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createEvent } from "@/lib/queries";

// Stands in for the booking flow the FOTOFOTO team would use — creates
// one Event (one QR/link, one tier), matching the confirmed model.
const CreateEventSchema = z.object({
  name: z.string().min(1),
  clientName: z.string().min(1),
  tier: z.enum(["full_access", "select"]),
  quota: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = CreateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const event = await createEvent(parsed.data);
  return NextResponse.json({ event }, { status: 201 });
}
