import { getEventBySlug, getEventPresetsConfig } from "@/lib/queries";
import { notFound } from "next/navigation";
import { ShootApp } from "./ShootApp";
import { BUILTIN_PRESET_META, customPresetRef } from "@/lib/presetMeta";

export const dynamic = "force-dynamic";

export default async function ShootPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const { builtins, custom } = await getEventPresetsConfig(event);
  const presets = [
    ...builtins.map((id) => ({
      id,
      name: BUILTIN_PRESET_META[id].name,
      swatch: BUILTIN_PRESET_META[id].swatch,
      swatchType: "gradient" as const,
    })),
    ...custom
      .filter((p) => p.enabled)
      .map((p) => ({
        id: customPresetRef(p.id),
        name: p.name,
        swatch: `/api/presets/${p.id}/preview`,
        swatchType: "image" as const,
      })),
  ];

  return <ShootApp slug={event.slug} eventName={event.name} initialPresets={presets} />;
}
