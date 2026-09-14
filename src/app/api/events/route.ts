import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createEvent, getClientById } from "@/lib/queries";

// Stands in for the booking flow the FOTOFOTO team would use — creates
// one Event (one QR/link, one tier), matching the confirmed model.
const CreateEventSchema = z.object({
  name: z.string().min(1),
  clientName: z.string().min(1),
  tier: z.enum(["full_access", "select"]),
  quota: z.number().int().positive().optional(),
  // Optional: links the event to a client portal account (see
  // clients table) so it shows up under that client's "Your library"
  // at /library. Without it the event still works exactly as before —
  // reachable only via its own /e/[slug] link/QR.
  clientId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = CreateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.clientId && !(await getClientById(parsed.data.clientId))) {
    return NextResponse.json({ error: "No client with that id." }, { status: 400 });
  }
  const event = await createEvent(parsed.data);
  return NextResponse.json({ event }, { status: 201 });
}
