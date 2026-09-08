import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEventBySlug, getEventPresetsConfig, setEnabledBuiltinPresets } from "@/lib/queries";
import { BUILTIN_PRESET_META, customPresetRef } from "@/lib/presetMeta";
import { presetEnum } from "@/db/schema";

/**
 * GET: the combined preset list for one event — built-ins (all four,
 * flagged enabled/disabled) plus the studio's custom presets. Used by
 * both the Control Room's preset manager and the photographer app's
 * preset picker, so they never drift apart.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const { builtins, custom } = await getEventPresetsConfig(event);

  return NextResponse.json({
    builtins: presetEnum.map((id) => ({
      id,
      name: BUILTIN_PRESET_META[id].name,
      swatch: BUILTIN_PRESET_META[id].swatch,
      enabled: builtins.includes(id),
    })),
    custom: custom.map((p) => ({
      id: customPresetRef(p.id),
      name: p.name,
      enabled: p.enabled,
      previewUrl: `/api/presets/${p.id}/preview`,
    })),
  });
}

const PatchBody = z.object({
  enabledBuiltins: z.array(z.enum(presetEnum)),
});

/** PATCH: sets which built-in presets this event offers. Custom
 * presets are toggled individually via
 * /api/events/[slug]/presets/custom/[id]. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const body = PatchBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "enabledBuiltins must be a list of preset ids" }, { status: 400 });

  await setEnabledBuiltinPresets(event.id, body.data.enabledBuiltins);
  return NextResponse.json({ ok: true });
}
