import { NextRequest, NextResponse } from "next/server";
import { getEventBySlug, getEventPresetsConfig } from "@/lib/queries";
import { renderPresetSample, type PresetSpec, type ColorStats } from "@/lib/image";
import { BUILTIN_PRESET_META, customPresetRef } from "@/lib/presetMeta";

/**
 * POST: the photographer app's "test a sample photo" action. Renders
 * one uploaded sample photo under every preset this event currently
 * offers, so the photographer can compare looks before picking one for
 * the shoot. Nothing here touches the DB or the event's storage —
 * these previews are thrown away by the client once shown.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });

  const file = form.get("photo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'photo' file field" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "The sample photo is empty (0 bytes)." }, { status: 400 });
  }

  const raw = Buffer.from(await file.arrayBuffer());
  const { builtins, custom } = await getEventPresetsConfig(event);

  const specs: { id: string; name: string; spec: PresetSpec }[] = [
    ...builtins.map((id) => ({ id, name: BUILTIN_PRESET_META[id].name, spec: { kind: "builtin", id } as PresetSpec })),
    ...custom
      .filter((p) => p.enabled)
      .map((p) => ({
        id: customPresetRef(p.id),
        name: p.name,
        spec: {
          kind: "custom",
          stats: { mean: JSON.parse(p.statsMean), std: JSON.parse(p.statsStd) } as ColorStats,
        } as PresetSpec,
      })),
  ];

  try {
    const previews = await Promise.all(
      specs.map(async ({ id, name, spec }) => {
        const preview = await renderPresetSample(raw, spec);
        return { id, name, previewDataUrl: `data:image/webp;base64,${preview.toString("base64")}` };
      })
    );
    return NextResponse.json({ previews });
  } catch (err) {
    console.error("Preset sample rendering failed", err);
    return NextResponse.json({ error: "Could not render the sample photo" }, { status: 500 });
  }
}
