import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPhoto, listPhotoAnnotations, createPhotoAnnotation } from "@/lib/queries";
import { getCurrentContact, formatAuthorName } from "@/lib/session";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contact = await getCurrentContact();
  if (!contact) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  const rows = await listPhotoAnnotations(id);
  const annotations = rows.map((row, index) => ({
    id: row.id,
    number: index + 1,
    xPct: row.xPct,
    yPct: row.yPct,
    note: row.note,
    author: formatAuthorName(row.contactId, row.contact.name, contact.contactId),
    createdAt: row.createdAt,
  }));

  return NextResponse.json({ annotations });
}

const Body = z.object({
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  note: z.string().trim().min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contact = await getCurrentContact();
  if (!contact) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await createPhotoAnnotation({
    photoId: id,
    contactId: contact.contactId,
    xPct: parsed.data.xPct,
    yPct: parsed.data.yPct,
    note: parsed.data.note,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
