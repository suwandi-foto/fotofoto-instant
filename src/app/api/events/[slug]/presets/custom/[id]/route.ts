import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEventBySlug, getCustomPreset, setCustomPresetEnabled, deleteCustomPreset } from "@/lib/queries";
import { deleteObject } from "@/lib/storage";

async function requireOwnedPreset(slug: string, id: string) {
  const event = await getEventBySlug(slug);
  if (!event) return { error: NextResponse.json({ error: "Event not found" }, { status: 404 }) } as const;
  const preset = await getCustomPreset(id);
  if (!preset || preset.eventId !== event.id) {
    return { error: NextResponse.json({ error: "Preset not found" }, { status: 404 }) } as const;
  }
  return { event, preset } as const;
}

const PatchBody = z.object({ enabled: z.boolean() });

/** PATCH: show/hide a custom preset in the photographer app without
 * deleting it. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;
  const result = await requireOwnedPreset(slug, id);
  if ("error" in result) return result.error;

  const body = PatchBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "'enabled' must be a boolean" }, { status: 400 });

  await setCustomPresetEnabled(id, body.data.enabled);
  return NextResponse.json({ ok: true });
}

/** DELETE: permanently removes a custom preset and its reference
 * thumbnail. Photos already processed with it keep their stored
 * "custom:<id>" preset id — deleting the preset does not touch them. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;
  const result = await requireOwnedPreset(slug, id);
  if ("error" in result) return result.error;

  const deleted = await deleteCustomPreset(id);
  if (deleted) await deleteObject(deleted.referencePath);

  return NextResponse.json({ ok: true });
}
