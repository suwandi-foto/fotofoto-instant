import type { Preset } from "@/db/schema";

/** Display metadata for the four built-in presets — shared between
 * the Control Room's preset manager and the photographer app's preset
 * picker so both list the same names in the same order. Plain data,
 * safe to import from client components too. */
export const BUILTIN_PRESET_META: Record<Preset, { name: string; swatch: string }> = {
  original: { name: "Original / No Edit", swatch: "linear-gradient(155deg, #e8e8e8, #a8a8a8)" },
  warm: { name: "Warm / Editorial", swatch: "linear-gradient(155deg, #cf9a52, #8a5a34)" },
  bright: { name: "Bright / Corporate", swatch: "linear-gradient(155deg, #cfe0f0, #9db6cf)" },
  bw: { name: "B&W", swatch: "linear-gradient(155deg, #d8d8d8, #4a4a4a)" },
  contrast: { name: "High Contrast", swatch: "linear-gradient(155deg, #e6e2d4, #22283a)" },
};

export const CUSTOM_PRESET_PREFIX = "custom:";

export function customPresetRef(id: string) {
  return `${CUSTOM_PRESET_PREFIX}${id}`;
}

export function parseCustomPresetRef(presetId: string): string | null {
  return presetId.startsWith(CUSTOM_PRESET_PREFIX) ? presetId.slice(CUSTOM_PRESET_PREFIX.length) : null;
}
