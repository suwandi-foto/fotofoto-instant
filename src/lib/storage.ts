/**
 * Storage adapter — local disk by default; Cloudflare R2 is the
 * confirmed target for production (zero-egress pricing, which matters
 * a lot here since guests downloading full-res photos is the core
 * product action — swapping this file for an S3-compatible client is
 * the only change needed to go live).
 *
 * Set STORAGE_BACKEND=drive to instead store everything in a Google
 * Drive account — see googleDrive.ts for what that trades away
 * (no CDN, personal storage quota, per-user API limits) versus R2.
 * Nothing outside this file should know or care which backend is
 * active.
 */
import fs from "node:fs/promises";
import path from "node:path";

const BACKEND = process.env.STORAGE_BACKEND === "drive" ? "drive" : "local";

// Statically scoped to ./storage (per Next's build-tracing guidance —
// a dynamic/env-driven root causes the whole project to be traced
// into the server bundle). STORAGE_ROOT can still override at
// runtime; the ignore comment just tells the bundler not to follow it.
const ROOT = process.env.STORAGE_ROOT || path.join(process.cwd(), "storage");

async function ensureDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function putObject(key: string, data: Buffer): Promise<void> {
  if (BACKEND === "drive") {
    const drive = await import("./googleDrive");
    return drive.putObject(key, data);
  }
  const filePath = path.join(/* turbopackIgnore: true */ ROOT, key);
  await ensureDir(filePath);
  await fs.writeFile(filePath, data);
}

export async function getObject(key: string): Promise<Buffer> {
  if (BACKEND === "drive") {
    const drive = await import("./googleDrive");
    return drive.getObject(key);
  }
  const filePath = path.join(/* turbopackIgnore: true */ ROOT, key);
  return fs.readFile(filePath);
}

export async function objectExists(key: string): Promise<boolean> {
  if (BACKEND === "drive") {
    const drive = await import("./googleDrive");
    return drive.objectExists(key);
  }
  try {
    await fs.access(path.join(/* turbopackIgnore: true */ ROOT, key));
    return true;
  } catch {
    return false;
  }
}

/** Storage keys are deliberately unguessable-ish but this is not an
 * access-control boundary — see the brief's "no login" tradeoff. In
 * production, download endpoints would issue short-lived signed R2
 * URLs rather than proxying bytes through the app server directly. */
export function originalKey(eventId: string, photoId: string) {
  return `originals/${eventId}/${photoId}.jpg`;
}

export function previewKey(eventId: string, photoId: string) {
  return `previews/${eventId}/${photoId}.webp`;
}

export function rawUploadKey(eventId: string, uploadId: string) {
  return `raw-uploads/${eventId}/${uploadId}.upload`;
}

/** Starts a resumable upload session the *browser* can send raw photo
 * bytes to directly, bypassing our own server (and its host platform's
 * request-body size limit — see POST /api/events/[slug]/photos/init).
 * Only meaningful for the Drive backend, which is Google's own
 * upload infrastructure; local disk has no equivalent client-reachable
 * upload target, so this throws for that backend rather than pretend
 * to support it. */
export async function createResumableUploadSession(key: string, mimeType: string): Promise<string> {
  if (BACKEND !== "drive") {
    throw new Error("Chunked upload requires STORAGE_BACKEND=drive.");
  }
  const drive = await import("./googleDrive");
  return drive.createResumableUploadSession(key, mimeType);
}

/** Relays one chunk of an upload session (from createResumableUploadSession
 * above) to the backend, server-side — see POST
 * /api/events/[slug]/photos/chunk. */
export async function uploadChunk(
  uploadUrl: string,
  chunk: Buffer,
  start: number,
  total: number
): Promise<{ done: boolean }> {
  if (BACKEND !== "drive") {
    throw new Error("Chunked upload requires STORAGE_BACKEND=drive.");
  }
  const drive = await import("./googleDrive");
  return drive.uploadChunk(uploadUrl, chunk, start, total);
}

export function presetReferenceKey(eventId: string, presetId: string) {
  return `presets/${eventId}/${presetId}.jpg`;
}

/** Best-effort delete of a single object by key — used for the
 * custom-preset reference image cleanup and for the raw-upload temp
 * file left behind by the direct-to-Drive upload flow (see
 * POST /api/events/[slug]/photos/complete). Failures are logged and
 * swallowed rather than thrown; a stray leftover file isn't worth
 * failing the caller's actual work over. */
export async function deleteObject(key: string): Promise<void> {
  try {
    if (BACKEND === "drive") {
      const drive = await import("./googleDrive");
      await drive.deleteFile(key);
      return;
    }
    await fs.unlink(path.join(/* turbopackIgnore: true */ ROOT, key));
  } catch (err) {
    console.warn(`[storage] could not remove object ${key}:`, err);
  }
}

/** Best-effort cleanup of everything an event ever wrote to storage —
 * originals, previews, and any custom-preset reference images. Called
 * when an event is deleted; failures here are logged and swallowed
 * rather than blocking the delete, since the DB rows (the source of
 * truth for what's "live") are already gone by that point. */
export async function deleteEventObjects(eventId: string): Promise<void> {
  if (BACKEND === "drive") {
    const drive = await import("./googleDrive");
    for (const prefix of ["originals", "previews", "presets"]) {
      try {
        await drive.deleteFolder([prefix, eventId]);
      } catch (err) {
        console.warn(`[storage] could not remove Drive folder ${prefix}/${eventId}:`, err);
      }
    }
    return;
  }

  const dirs = [
    path.join(/* turbopackIgnore: true */ ROOT, "originals", eventId),
    path.join(/* turbopackIgnore: true */ ROOT, "previews", eventId),
    path.join(/* turbopackIgnore: true */ ROOT, "presets", eventId),
  ];
  for (const dir of dirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[storage] could not remove ${dir}:`, err);
    }
  }
}
