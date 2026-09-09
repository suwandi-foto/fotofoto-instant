import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPhoto, decideVideoReview } from "@/lib/queries";
import { getCurrentContact, formatAuthorName } from "@/lib/session";

const Body = z.object({ decision: z.enum(["approve", "revise"]) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contact = await getCurrentContact();
  if (!contact) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo || photo.kind !== "video") {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await decideVideoReview(id, contact.contactId, parsed.data.decision);
  if (!updated) {
    return NextResponse.json({ error: "This video has already been decided." }, { status: 409 });
  }

  return NextResponse.json({
    review: {
      status: updated.status,
      decidedAt: updated.decidedAt,
      decidedByName: formatAuthorName(contact.contactId, contact.name, contact.contactId),
    },
  });
}
