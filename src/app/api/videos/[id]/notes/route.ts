import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPhoto, listVideoNotes, createVideoNote } from "@/lib/queries";
import { getCurrentContact, formatAuthorName } from "@/lib/session";

async function getVideoOr404(id: string) {
  const photo = await getPhoto(id);
  if (!photo || photo.kind !== "video") return null;
  return photo;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contact = await getCurrentContact();
  if (!contact) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  const video = await getVideoOr404(id);
  if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });

  const rows = await listVideoNotes(id);
  const notes = rows.map((row) => ({
    id: row.id,
    timestampSeconds: row.timestampSeconds,
    note: row.note,
    author: formatAuthorName(row.contactId, row.contact.name, contact.contactId),
    createdAt: row.createdAt,
  }));

  return NextResponse.json({ notes });
}

const Body = z.object({
  timestampSeconds: z.number().min(0).max(86400),
  note: z.string().trim().min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contact = await getCurrentContact();
  if (!contact) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  const video = await getVideoOr404(id);
  if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await createVideoNote({
    photoId: id,
    contactId: contact.contactId,
    timestampSeconds: parsed.data.timestampSeconds,
    note: parsed.data.note,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
