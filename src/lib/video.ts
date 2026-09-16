/**
 * Video processing pipeline — the video-kind counterpart to image.ts.
 * Runs once per captured video, same two-rendition rule as photos
 * (compressed preview for review; untouched original only ever
 * reachable through an explicit download), plus a third rendition
 * photos don't need: a static thumbnail frame for the gallery grid,
 * since previewPath here is playable media, not something an <img> can
 * render.
 *
 * Uses ffmpeg via @ffmpeg-installer/ffmpeg (a bundled static binary,
 * not whatever may or may not be on the host's PATH) + fluent-ffmpeg.
 * fluent-ffmpeg's API is file-path-oriented, not buffer-in/buffer-out
 * like sharp, so this shells out through temp files under node:os's
 * tmpdir and cleans them up in a finally block.
 */
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import ffprobePath from "@ffprobe-installer/ffprobe";
import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import { chmodSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Some hosts' npm install skips postinstall scripts (often the default
// on CI/build platforms, for supply-chain-security reasons) — that's
// the step these installer packages rely on to mark their vendored
// binary executable. The file itself still ends up in node_modules
// (confirmed: Hostinger production hit this exactly, spawn EACCES on
// an otherwise-present ffprobe binary), so every ffmpeg/ffprobe spawn
// fails despite the binary being right where it's expected. Restoring
// the bit ourselves is idempotent and a no-op when it was already set.
for (const bin of [ffmpegPath.path, ffprobePath.path]) {
  try {
    chmodSync(bin, 0o755);
  } catch (err) {
    console.warn(`[video] could not chmod ${bin} executable:`, err);
  }
}

ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

const PREVIEW_MAX_WIDTH = 640;
const THUMBNAIL_AT_SECONDS = 1;

export type VideoMeta = {
  thumbnail: Buffer;
  width: number;
  height: number;
  durationSeconds: number;
  orientation: "portrait" | "landscape" | "square";
};

function probe(filePath: string): Promise<ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

function runFfmpeg(command: ffmpeg.FfmpegCommand, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    command
      .on("error", (err) => reject(new Error(`ffmpeg ${label} failed: ${err.message}`)))
      .on("end", () => resolve())
      .run();
  });
}

/** Tiled "FOTOFOTO" watermark PNG, sized to the preview's output
 * dimensions — same visual language as image.ts's watermarkSvg (tiled
 * rotated text + a "LOW-RES" badge), rendered once with sharp and
 * composited onto every frame via ffmpeg's overlay filter, since ffmpeg
 * itself has no equivalent of Sharp's SVG compositing. */
async function renderWatermarkPng(width: number, height: number): Promise<Buffer> {
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
  const badge = `<rect x="14" y="14" width="128" height="24" rx="5" fill="rgba(0,0,0,0.4)"/>
    <text x="22" y="31" font-family="sans-serif" font-weight="800" font-size="12"
      letter-spacing="0.5" fill="rgba(255,255,255,0.8)">LOW-RES DRAFT</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    ${texts}
    ${badge}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * The fast half of the pipeline: probe (dimensions/duration/rotation)
 * plus a single-frame thumbnail extraction. Cheap enough to run inline
 * with the upload request — see POST .../photos/complete, which stores
 * the original + this thumbnail synchronously and only defers the
 * expensive part (transcodeVideoPreview below) to a background after()
 * call, so the row has something real to show immediately instead of
 * sitting at "queued" with nothing.
 */
export async function extractVideoMeta(raw: Buffer): Promise<VideoMeta> {
  if (raw.length === 0) {
    throw new Error("Cannot process an empty video buffer (0 bytes).");
  }

  const dir = await mkdtemp(path.join(tmpdir(), "ff-video-meta-"));
  const inputPath = path.join(dir, "input");
  const thumbnailPath = path.join(dir, "thumb.jpg");

  try {
    await writeFile(inputPath, raw);

    const meta = await probe(inputPath);
    const videoStream = meta.streams.find((s) => s.codec_type === "video");
    if (!videoStream) throw new Error("No video stream found in the uploaded file.");

    // Rotation metadata (phones shoot portrait video tagged with a
    // rotate side-data / display matrix, not physically-rotated frames)
    // means codedWidth/height can report landscape even for a portrait
    // clip — ffmpeg's own scale/thumbnail filters already respect that
    // metadata when decoding, so this only affects orientation/logical
    // width-height bookkeeping, not the actual pixels written out.
    const rotation = Math.abs(Number(videoStream.rotation ?? videoStream.tags?.rotate ?? 0));
    const rotated90 = rotation === 90 || rotation === 270;
    const rawWidth = videoStream.width ?? 0;
    const rawHeight = videoStream.height ?? 0;
    const width = rotated90 ? rawHeight : rawWidth;
    const height = rotated90 ? rawWidth : rawHeight;
    const durationSeconds = Number(meta.format.duration ?? videoStream.duration ?? 0);
    const orientation: VideoMeta["orientation"] =
      width === height ? "square" : width > height ? "landscape" : "portrait";

    // .screenshots() is its own self-triggering command (it starts
    // ffmpeg internally the moment it's called), unlike the
    // .output(...).run() shape runFfmpeg wraps below for the preview
    // transcode — listeners have to be attached first, not run()
    // called after.
    const thumbAt = Math.min(THUMBNAIL_AT_SECONDS, Math.max(0, durationSeconds / 2));
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .on("error", (err) => reject(new Error(`ffmpeg thumbnail extraction failed: ${err.message}`)))
        .on("end", () => resolve())
        .screenshots({
          timestamps: [thumbAt],
          filename: path.basename(thumbnailPath),
          folder: dir,
          size: "480x?",
        });
    });

    const thumbnail = await readFile(thumbnailPath);
    return { thumbnail, width, height, durationSeconds, orientation };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The slow half: a full re-encode, scaled down and watermarked (baked
 * in, not applied on the fly) when the event is select-tier — mirrors
 * image.ts's watermark rule exactly. Meant to run inside after(), not
 * inline with the request — see extractVideoMeta's doc comment.
 */
export async function transcodeVideoPreview(
  raw: Buffer,
  dims: { width: number; height: number },
  watermark: boolean
): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "ff-video-preview-"));
  const inputPath = path.join(dir, "input");
  const previewPath = path.join(dir, "preview.mp4");
  const watermarkPath = path.join(dir, "watermark.png");

  try {
    await writeFile(inputPath, raw);

    let command = ffmpeg(inputPath)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-crf 30", "-preset veryfast", "-movflags +faststart"]);

    if (watermark) {
      const previewWidth = Math.min(PREVIEW_MAX_WIDTH, dims.width || PREVIEW_MAX_WIDTH);
      const previewHeight = Math.round(
        (previewWidth / (dims.width || previewWidth)) * (dims.height || previewWidth)
      );
      const watermarkPng = await renderWatermarkPng(previewWidth, previewHeight || previewWidth);
      await writeFile(watermarkPath, watermarkPng);
      command = command
        .input(watermarkPath)
        .complexFilter([`[0:v]scale=${PREVIEW_MAX_WIDTH}:-2[scaled]`, `[scaled][1:v]overlay=0:0[out]`])
        .outputOptions(["-map", "[out]", "-map", "0:a?"]);
    } else {
      command = command.videoFilters(`scale=${PREVIEW_MAX_WIDTH}:-2`);
    }

    await runFfmpeg(command.output(previewPath), "preview transcode");
    return await readFile(previewPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// isVideoContentType/isVideoFileName moved to ./videoContentType — see
// that file's doc comment for why they can't live here.
