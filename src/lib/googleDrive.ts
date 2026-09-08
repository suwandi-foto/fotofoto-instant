/**
 * Google Drive-backed storage adapter — an alternative to local disk /
 * R2 for anyone who wants to point this app at their own Drive account
 * instead of paying for a separate object store.
 *
 * Explicitly a stopgap, not the target architecture: Drive has no
 * public CDN in front of it, its per-user API quotas aren't built for
 * many simultaneous strangers downloading files (event guests), and a
 * personal account's storage quota (15GB free, or whatever your Google
 * One plan gives you) fills up fast once you're storing full-res
 * originals across multiple events. Fine to start with; plan to move
 * to R2 once real client galleries are in regular use — see storage.ts.
 *
 * Auth uses OAuth2 with a refresh token for *your* Google account
 * (not a service account — a plain service account has no Drive
 * storage quota of its own without Workspace domain-wide delegation,
 * which a personal Gmail account doesn't have). Run
 * `node scripts/drive-auth.mjs` once to obtain that refresh token —
 * see that script for the one-time setup steps.
 *
 * Scoped to `drive.file` — this app can only see/manage files and
 * folders it creates itself, never your existing Drive contents.
 */
import { google, drive_v3 } from "googleapis";
import { Readable } from "node:stream";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_FOLDER_NAME = "FOTOFOTO Instant Uploads";

let authClient: InstanceType<typeof google.auth.OAuth2> | null = null;

function getAuth() {
  if (authClient) return authClient;

  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "STORAGE_BACKEND=drive requires GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and " +
        "GOOGLE_DRIVE_REFRESH_TOKEN. Run `node scripts/drive-auth.mjs` to obtain a refresh token."
    );
  }

  authClient = new google.auth.OAuth2(clientId, clientSecret);
  authClient.setCredentials({ refresh_token: refreshToken });
  return authClient;
}

let driveClient: drive_v3.Drive | null = null;

function getDrive(): drive_v3.Drive {
  if (driveClient) return driveClient;
  driveClient = google.drive({ version: "v3", auth: getAuth() });
  return driveClient;
}

// Folder lookups are the expensive part (a Drive API round trip each),
// so resolved folder ids are cached in memory for the life of the
// server process, keyed by "<parentId>/<name>". A delete anywhere
// clears the whole cache rather than tracking precise invalidation —
// cheap given how infrequently deletes happen relative to reads.
const folderCache = new Map<string, string>();

let rootFolderIdPromise: Promise<string> | null = null;

async function getRootFolderId(): Promise<string> {
  if (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) return process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderIdPromise) {
    rootFolderIdPromise = findOrCreateFolder("root", ROOT_FOLDER_NAME);
  }
  return rootFolderIdPromise;
}

async function findFolder(parentId: string, name: string): Promise<string | null> {
  const cacheKey = `${parentId}/${name}`;
  const cached = folderCache.get(cacheKey);
  if (cached) return cached;

  const drive = getDrive();
  const escapedName = name.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escapedName}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: "files(id, name)",
    spaces: "drive",
  });
  const found = res.data.files?.[0]?.id;
  if (found) folderCache.set(cacheKey, found);
  return found ?? null;
}

async function findOrCreateFolder(parentId: string, name: string): Promise<string> {
  const existing = await findFolder(parentId, name);
  if (existing) return existing;

  const drive = getDrive();
  const res = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: "id",
  });
  const id = res.data.id;
  if (!id) throw new Error(`Google Drive did not return an id when creating folder "${name}"`);
  folderCache.set(`${parentId}/${name}`, id);
  return id;
}

/** Walks a key's directory segments under the root folder, creating
 * any that don't exist yet when `createIfMissing` is true. Returns
 * null (rather than creating anything) if a segment is missing and
 * `createIfMissing` is false — the read/delete-side callers treat that
 * as "the object doesn't exist." */
async function resolveFolder(segments: string[], createIfMissing: boolean): Promise<string | null> {
  let parentId = await getRootFolderId();
  for (const segment of segments) {
    if (createIfMissing) {
      parentId = await findOrCreateFolder(parentId, segment);
    } else {
      const found = await findFolder(parentId, segment);
      if (!found) return null;
      parentId = found;
    }
  }
  return parentId;
}

async function findFile(folderId: string, name: string): Promise<string | null> {
  const drive = getDrive();
  const escapedName = name.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${folderId}' in parents and name = '${escapedName}' and trashed = false`,
    fields: "files(id, name)",
    spaces: "drive",
  });
  return res.data.files?.[0]?.id ?? null;
}

function mimeTypeFor(fileName: string): string {
  if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) return "image/jpeg";
  if (fileName.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function splitKey(key: string): { dirs: string[]; fileName: string } {
  const parts = key.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error(`Invalid storage key "${key}"`);
  return { dirs: parts, fileName };
}

export async function putObject(key: string, data: Buffer): Promise<void> {
  const { dirs, fileName } = splitKey(key);
  const folderId = await resolveFolder(dirs, true);
  if (!folderId) throw new Error(`Could not resolve/create Drive folder for "${key}"`);

  const drive = getDrive();
  const media = { mimeType: mimeTypeFor(fileName), body: Readable.from(data) };
  const existingFileId = await findFile(folderId, fileName);

  if (existingFileId) {
    await drive.files.update({ fileId: existingFileId, media });
  } else {
    await drive.files.create({ requestBody: { name: fileName, parents: [folderId] }, media, fields: "id" });
  }
}

/** Starts a Google Drive resumable-upload session for `key` and hands
 * back the session URL. The phone sends the photo to *our* server in
 * small same-origin chunks (see POST /api/events/[slug]/photos/chunk),
 * which relays each one to this URL server-side via uploadChunk below
 * — never a direct browser-to-Drive request. An earlier version had
 * the browser PUT straight to this URL itself (simpler, and it
 * sidesteps Vercel's ~4.5MB body cap just as well), but that
 * cross-origin request failed unexplained and 100% reproducibly on at
 * least one real device across two browsers, both networks, no VPN —
 * every same-origin request to our own server on that same device
 * worked every time, which is why the relay goes through us instead.
 * See POST /api/events/[slug]/photos/init, which calls this. */
export async function createResumableUploadSession(key: string, mimeType: string): Promise<string> {
  const { dirs, fileName } = splitKey(key);
  const folderId = await resolveFolder(dirs, true);
  if (!folderId) throw new Error(`Could not resolve/create Drive folder for "${key}"`);

  const auth = getAuth();
  const { token } = await auth.getAccessToken();
  if (!token) throw new Error("Could not obtain a Google Drive access token.");

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
    },
    body: JSON.stringify({ name: fileName, parents: [folderId] }),
  });
  if (!res.ok) {
    throw new Error(`Failed to start a Google Drive resumable upload session (HTTP ${res.status}).`);
  }
  const uploadUrl = res.headers.get("location");
  if (!uploadUrl) throw new Error("Google Drive did not return a resumable upload session URL.");
  return uploadUrl;
}

/** Relays one chunk of a resumable upload (opened by
 * createResumableUploadSession above) to Drive, server-side. Per
 * Drive's protocol, every chunk but the last must be a multiple of
 * 256 KiB, declared via a `Content-Range: bytes start-end/total`
 * header — see POST /api/events/[slug]/photos/chunk, the only caller.
 * Returns whether Drive considers the upload complete after this
 * chunk (true only once `start + chunk.length === total`). */
export async function uploadChunk(
  uploadUrl: string,
  chunk: Buffer,
  start: number,
  total: number
): Promise<{ done: boolean }> {
  const end = start + chunk.length - 1;
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(chunk.length),
      "Content-Range": `bytes ${start}-${end}/${total}`,
    },
    body: new Uint8Array(chunk),
  });
  // 308 = Drive accepted this chunk and is waiting for more. 200/201 =
  // this was the last chunk and the file is now complete. Anything
  // else means the session broke (expired, wrong range, etc).
  if (res.status === 308) return { done: false };
  if (res.status === 200 || res.status === 201) return { done: true };
  const body = await res.text().catch(() => "");
  throw new Error(`Drive rejected upload chunk (HTTP ${res.status}): ${body.slice(0, 300)}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const { dirs, fileName } = splitKey(key);
  const folderId = await resolveFolder(dirs, false);
  const fileId = folderId ? await findFile(folderId, fileName) : null;
  if (!fileId) throw new Error(`Object not found in Google Drive: "${key}"`);

  const drive = getDrive();
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(res.data as ArrayBuffer);
}

export async function objectExists(key: string): Promise<boolean> {
  const { dirs, fileName } = splitKey(key);
  const folderId = await resolveFolder(dirs, false);
  if (!folderId) return false;
  return (await findFile(folderId, fileName)) !== null;
}

export async function deleteFile(key: string): Promise<void> {
  const { dirs, fileName } = splitKey(key);
  const folderId = await resolveFolder(dirs, false);
  const fileId = folderId ? await findFile(folderId, fileName) : null;
  if (!fileId) return;
  await getDrive().files.delete({ fileId });
}

/** Deletes an entire folder (and everything inside it) by its path
 * segments under the root — used for the "wipe everything an event
 * ever wrote" cleanup, mirroring the local-disk adapter's recursive
 * directory removal. */
export async function deleteFolder(segments: string[]): Promise<void> {
  const folderId = await resolveFolder(segments, false);
  if (!folderId) return;
  await getDrive().files.delete({ fileId: folderId });
  folderCache.clear();
}
