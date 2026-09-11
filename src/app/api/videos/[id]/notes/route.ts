import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPhotoWithEventClientId, listVideoNotes, createVideoNote } from "@/lib/queries";
import { getCurrentClient } from "@/lib/session";
import type { CurrentClient } from "@/lib/session";

async function getOwnedVideoOr404(id: string, client: CurrentClient) {
  const photo = await getPhotoWithEventClientId(id);
  if (!photo || photo.kind !== "video" || photo.event.clientId !== client.clientId) return null;
  return photo;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await getCurrentClient();
  if (!client) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  const video = await getOwnedVideoOr404(id, client);
  if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });

  const rows = await listVideoNotes(id);
  const notes = rows.map((row) => ({
    id: row.id,
    timestampSeconds: row.timestampSeconds,
    note: row.note,
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
  const client = await getCurrentClient();
  if (!client) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  const video = await getOwnedVideoOr404(id, client);
  if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await createVideoNote({
    photoId: id,
    clientId: client.clientId,
    timestampSeconds: parsed.data.timestampSeconds,
    note: parsed.data.note,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
