/**
 * Image processing pipeline — runs once per photo, right after the
 * phone app uploads it.
 *
 * Produces exactly two renditions, matching the confirmed
 * bandwidth/cost rule: galleries only ever load the compressed
 * preview; the full-resolution original is stored untouched and only
 * ever leaves the server through an explicit download request.
 */
import sharp, { type Sharp } from "sharp";
import type { Preset } from "@/db/schema";

const PREVIEW_MAX_EDGE = 1000;
const PREVIEW_QUALITY = 75;

/** Cheap, deterministic per-preset "look" — a real system would use
 * proper graded LUTs; this applies the same modulate/tint moves the
 * mockup's four presets implied (Warm/Editorial, Bright/Corporate,
 * B&W, High Contrast). */
function applyBuiltinPreset(image: Sharp, preset: Preset): Sharp {
  switch (preset) {
    case "original":
      return image;
    case "warm":
      return image
        .modulate({ saturation: 1.12, brightness: 1.02 })
        .tint({ r: 255, g: 235, b: 210 });
    case "bright":
      return image.modulate({ saturation: 0.92, brightness: 1.12 }).linear(1.05, -8);
    case "bw":
      return image.greyscale().linear(1.08, -6);
    case "contrast":
      return image.linear(1.25, -28).modulate({ saturation: 1.05 });
    default:
      return image;
  }
}

/** Per-channel color statistics used for the custom-preset color
 * match below — mean and standard deviation of each RGB channel
 * across the whole image. */
export type ColorStats = {
  mean: [number, number, number];
  std: [number, number, number];
};

export async function computeColorStats(buf: Buffer): Promise<ColorStats> {
  const { channels } = await sharp(buf).stats();
  return {
    mean: [channels[0].mean, channels[1].mean, channels[2].mean],
    std: [channels[0].stdev, channels[1].stdev, channels[2].stdev],
  };
}

export type PresetSpec = { kind: "builtin"; id: Preset } | { kind: "custom"; stats: ColorStats };

// Clamp the per-channel contrast adjustment so an unusually flat or
// noisy reference/source photo can't blow the result out — a plain
// mean/stdev match with no clamp can swing wildly on outlier stats.
const STD_SCALE_MIN = 0.6;
const STD_SCALE_MAX = 1.8;

/** Custom presets aren't a real LUT — there's no graded file to apply.
 * Instead, this matches each captured photo's per-channel brightness
 * and contrast to whatever the studio's reference photo measured at
 * upload time (see computeColorStats), the same "cheap, deterministic"
 * tradeoff the four built-in presets make above. */
async function applyCustomPreset(image: Sharp, raw: Buffer, target: ColorStats): Promise<Sharp> {
  const source = await computeColorStats(raw);
  const scale: [number, number, number] = [1, 1, 1];
  const offset: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const rawScale = source.std[c] > 1 ? target.std[c] / source.std[c] : 1;
    scale[c] = Math.min(STD_SCALE_MAX, Math.max(STD_SCALE_MIN, rawScale));
    offset[c] = target.mean[c] - source.mean[c] * scale[c];
  }
  return image.linear(scale, offset);
}

async function applyPresetSpec(image: Sharp, raw: Buffer, spec: PresetSpec): Promise<Sharp> {
  return spec.kind === "builtin" ? applyBuiltinPreset(image, spec.id) : applyCustomPreset(image, raw, spec.stats);
}

export type ProcessedPhoto = {
  original: Buffer;
  preview: Buffer;
  width: number;
  height: number;
  orientation: "portrait" | "landscape" | "square";
};

function watermarkSvg(width: number, height: number): Buffer {
  // Tiled, rotated "FOTOFOTO" text — mirrors the select-tier mockup.
  const tileW = 220;
  const tileH = 120;
  const cols = Math.ceil(width / tileW) + 1;
  const rows = Math.ceil(height / tileH) + 1;
  let texts = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * tileW - tileW / 2;
      const y = r * tileH;
      texts += `<text x="${x}" y="${y}" transform="rotate(-24 ${x} ${y})"
        font-family="sans-serif" font-weight="700" font-size="22"
        letter-spacing="3" fill="rgba(255,255,255,0.32)">FOTOFOTO</text>`;
    }
  }
  const badge = `<rect x="14" y="14" width="88" height="22" rx="5" fill="rgba(0,0,0,0.35)"/>
    <text x="22" y="30" font-family="sans-serif" font-weight="800" font-size="12"
      letter-spacing="0.5" fill="rgba(255,255,255,0.75)">LOW-RES</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    ${texts}
    ${badge}
  </svg>`;
  return Buffer.from(svg);
}

export async function processCapturedPhoto(
  raw: Buffer,
  preset: PresetSpec,
  watermark: boolean
): Promise<ProcessedPhoto> {
  if (raw.length === 0) {
    // The API route already rejects an empty upload before this is
    // called; this guard is a clear failure message for any other
    // caller, instead of Sharp's opaque "Input Buffer is empty".
    throw new Error("Cannot process an empty image buffer (0 bytes).");
  }
  const base = sharp(raw).rotate(); // auto-orient from EXIF
  const meta = await base.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const orientation: ProcessedPhoto["orientation"] =
    width === height ? "square" : width > height ? "landscape" : "portrait";

  const graded = await applyPresetSpec(sharp(raw).rotate(), raw, preset);
  const original = await graded.jpeg({ quality: 92 }).toBuffer();

  let previewPipeline = sharp(original).resize({
    width: PREVIEW_MAX_EDGE,
    height: PREVIEW_MAX_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });

  if (watermark) {
    // sharp's .metadata() reflects the *input* image, not a pending
    // resize in the same pipeline — compute the actual output size of
    // the "fit: inside" resize ourselves so the watermark SVG we
    // composite matches exactly (composite requires same-or-smaller
    // dimensions, so any mismatch here throws).
    const longEdge = Math.max(width, height) || PREVIEW_MAX_EDGE;
    const scale = Math.min(1, PREVIEW_MAX_EDGE / longEdge);
    const pw = Math.max(1, Math.round(width * scale));
    const ph = Math.max(1, Math.round(height * scale));
    previewPipeline = previewPipeline
      .composite([{ input: watermarkSvg(pw, ph), top: 0, left: 0 }])
      .modulate({ saturation: 0.55, brightness: 0.85 });
  }

  const preview = await previewPipeline.webp({ quality: PREVIEW_QUALITY }).toBuffer();

  return { original, preview, width, height, orientation };
}

/** Renders a small, unwatermarked preview of `raw` under one preset —
 * used by the photographer app's "test a sample photo" flow to show
 * what each preset would look like before committing to one. Doesn't
 * touch storage or the DB; the caller discards the bytes once shown. */
export async function renderPresetSample(raw: Buffer, preset: PresetSpec): Promise<Buffer> {
  const graded = await applyPresetSpec(sharp(raw).rotate(), raw, preset);
  return graded
    .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();
}
