/**
 * Cloudflare R2-backed storage adapter — the confirmed production
 * target (see storage.ts's top comment). R2 is S3-compatible, so this
 * is a plain @aws-sdk/client-s3 client pointed at R2's account-scoped
 * endpoint rather than AWS.
 *
 * The resumable-upload pair (createResumableUploadSession/uploadChunk)
 * matters here for a non-obvious reason: the photographer app's upload
 * queue (offlineQueue.ts) always drives photos through the three-step
 * init -> chunk -> complete protocol, in fixed 3MiB chunks, regardless
 * of which storage backend is active — there's no simpler direct-upload
 * path to fall back to. So this backend has to answer that same
 * protocol, not just implement a plain putObject. It's backed by S3
 * Multipart Upload, which requires every part but the last to be
 * >=5MiB; since the client's chunks are smaller than that, chunks are
 * buffered here (in memory, per session) until there's enough to flush
 * as one part. That buffering is only safe because this app runs as a
 * persistent Node process (Hostinger), not a serverless function pool
 * where a later chunk could land on a different, memory-less instance
 * than the one that buffered the earlier ones.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`STORAGE_BACKEND=r2 requires ${name} to be set.`);
  }
  return value;
}

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (s3Client) return s3Client;
  const accountId = getEnv("R2_ACCOUNT_ID");
  s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: getEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: getEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return s3Client;
}

function getBucket(): string {
  return getEnv("R2_BUCKET");
}

function mimeTypeFor(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}

export async function putObject(key: string, data: Buffer): Promise<void> {
  await getClient().send(
    new PutObjectCommand({ Bucket: getBucket(), Key: key, Body: data, ContentType: mimeTypeFor(key) })
  );
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await getClient().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  const body = res.Body;
  if (!body) throw new Error(`Object not found in R2: "${key}"`);
  // The SDK's response body carries transformToByteArray() on every
  // runtime it supports (Node included) since v3's stream mixin — no
  // need to branch on web vs. Node stream ourselves.
  const bytes = await body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
    return true;
  } catch (err) {
    const name = (err as { name?: string }).name;
    const statusCode = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (name === "NotFound" || name === "NoSuchKey" || statusCode === 404) return false;
    throw err;
  }
}

export async function deleteFile(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

/** Lists and batch-deletes every object under a folder-ish prefix
 * (segments joined with "/"), paginating through ListObjectsV2 and
 * deleting in batches of up to 1000 (DeleteObjectsCommand's max) —
 * mirrors the local adapter's recursive directory removal and Drive's
 * whole-folder delete. Runs only on event deletion, so throughput
 * doesn't matter here. */
export async function deleteFolder(segments: string[]): Promise<void> {
  const prefix = `${segments.join("/")}/`;
  const bucket = getBucket();
  const client = getClient();
  let continuationToken: string | undefined;

  do {
    const listRes = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken })
    );
    const keys = (listRes.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch } }));
    }
    continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined;
  } while (continuationToken);
}

// S3-compatible multipart upload requires every part but the last to
// be at least 5MiB; the client's chunks (see offlineQueue.ts) are
// 3MiB, so chunks are accumulated here until there's enough to flush,
// or until the final chunk arrives (which flushes whatever's left,
// under-sized or not — only non-final parts have a minimum).
const MIN_PART_SIZE = 5 * 1024 * 1024;

type MultipartSession = {
  key: string;
  uploadId: string;
  nextPartNumber: number;
  parts: { ETag: string; PartNumber: number }[];
  bufferedChunks: Buffer[];
  bufferedBytes: number;
};

// Keyed by uploadId (already globally unique per R2's API contract, so
// it doubles as the opaque session token handed back to the client as
// `uploadUrl` — see storage.ts's createResumableUploadSession). Lives
// only in this process's memory: fine on a persistent Node deployment,
// but an upload abandoned mid-flight (tab closed, permanent network
// loss) leaks both this map entry and an incomplete R2 multipart
// upload, which R2 only reclaims via a bucket lifecycle rule for
// aborting stale multipart uploads — not configured here.
const sessions = new Map<string, MultipartSession>();

export async function createResumableUploadSession(key: string, mimeType: string): Promise<string> {
  const res = await getClient().send(
    new CreateMultipartUploadCommand({ Bucket: getBucket(), Key: key, ContentType: mimeType })
  );
  const uploadId = res.UploadId;
  if (!uploadId) throw new Error("R2 did not return an UploadId for the multipart upload.");
  sessions.set(uploadId, { key, uploadId, nextPartNumber: 1, parts: [], bufferedChunks: [], bufferedBytes: 0 });
  return uploadId;
}

async function flushPart(session: MultipartSession): Promise<void> {
  if (session.bufferedBytes === 0) return;
  const body = Buffer.concat(session.bufferedChunks);
  session.bufferedChunks = [];
  session.bufferedBytes = 0;
  const partNumber = session.nextPartNumber++;
  const res = await getClient().send(
    new UploadPartCommand({
      Bucket: getBucket(),
      Key: session.key,
      UploadId: session.uploadId,
      PartNumber: partNumber,
      Body: body,
    })
  );
  if (!res.ETag) throw new Error(`R2 did not return an ETag for part ${partNumber}.`);
  session.parts.push({ ETag: res.ETag, PartNumber: partNumber });
}

export async function uploadChunk(
  uploadUrl: string,
  chunk: Buffer,
  start: number,
  total: number
): Promise<{ done: boolean }> {
  const session = sessions.get(uploadUrl);
  if (!session) {
    throw new Error("Unknown or already-completed R2 upload session.");
  }

  session.bufferedChunks.push(chunk);
  session.bufferedBytes += chunk.length;
  const isFinal = start + chunk.length >= total;

  try {
    if (session.bufferedBytes >= MIN_PART_SIZE || isFinal) {
      await flushPart(session);
    }

    if (!isFinal) return { done: false };

    await getClient().send(
      new CompleteMultipartUploadCommand({
        Bucket: getBucket(),
        Key: session.key,
        UploadId: session.uploadId,
        MultipartUpload: { Parts: session.parts },
      })
    );
    sessions.delete(uploadUrl);
    return { done: true };
  } catch (err) {
    sessions.delete(uploadUrl);
    await getClient()
      .send(new AbortMultipartUploadCommand({ Bucket: getBucket(), Key: session.key, UploadId: session.uploadId }))
      .catch(() => {});
    throw err;
  }
}
