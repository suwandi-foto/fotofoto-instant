import { NextRequest, NextResponse } from "next/server";
import { getPhoto, togglePhotoReaction } from "@/lib/queries";
import { getCurrentContact } from "@/lib/session";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contact = await getCurrentContact();
  if (!contact) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  const summary = await togglePhotoReaction(id, contact.contactId);
  return NextResponse.json(summary);
}
