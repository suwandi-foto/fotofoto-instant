/**
 * Client-side offline upload queue for the photographer's app.
 *
 * Confirmed requirement: if the connection drops mid-upload, photos
 * queue locally and retry automatically once connectivity returns —
 * no manual action from the photographer. This is a real IndexedDB
 * queue (survives a page reload / dropped connection), not just an
 * in-memory list, since that persistence is the actual point.
 *
 * The Capacitor-wrapped native build would use the same logic against
 * its own local file store; this browser IndexedDB version is what
 * makes the offline behavior testable in this web build today.
 */

export type QueueItemStatus = "queued" | "uploading" | "done" | "failed" | "stuck";

export type QueueItem = {
  id: string;
  eventSlug: string;
  preset: string;
  blob: Blob;
  fileName: string;
  createdAt: number;
  status: QueueItemStatus;
  attempts: number;
  lastError?: string;
};

/** What's actually written to IndexedDB — a Blob's raw bytes as an
 * ArrayBuffer plus its mime type, never the Blob object itself. Safari
 * has a long-standing bug where a Blob round-tripped through
 * IndexedDB can come back silently corrupted, so a fetch() sent with
 * it as the body just dies with a generic "Load failed" — with no
 * server-side trace, since the request never really goes anywhere. An
 * ArrayBuffer survives IndexedDB's structured-clone step reliably
 * everywhere; a fresh Blob is rebuilt from it only when something
 * actually needs one (see toQueueItem below). */
type StoredQueueRecord = Omit<QueueItem, "blob"> & { data: ArrayBuffer; mimeType: string };

async function toStoredRecord(item: QueueItem): Promise<StoredQueueRecord> {
  const { blob, ...rest } = item;
  return { ...rest, data: await blob.arrayBuffer(), mimeType: blob.type };
}

function toQueueItem(record: StoredQueueRecord): QueueItem {
  const { data, mimeType, ...rest } = record;
  return { ...rest, blob: new Blob([data], { type: mimeType }) };
}

const DB_NAME = "fotofoto-shoot-queue";
const STORE = "pending";

/** How many times a server-rejected upload (e.g. an unprocessable file)
 * is retried before we give up and mark it "stuck" instead of looping
 * forever. Network failures don't count against this — those are
 * expected to retry indefinitely per the offline requirement. */
const MAX_SERVER_ATTEMPTS = 3;

/** A failure while trying to send one queue item. `transient: true`
 * means the request never reached the server (offline / dropped
 * connection) — retry forever. `transient: false` means the server
 * responded with an error, so retrying the exact same bytes is
 * unlikely to ever succeed — count it toward the retry cap. */
class UploadAttemptError extends Error {
  constructor(message: string, public readonly transient: boolean) {
    super(message);
  }
}

/** In-flight requests, keyed by queue item id, so a cancel can abort a
 * genuinely in-progress upload rather than just hiding it from the UI. */
const activeUploads = new Map<string, AbortController>();
const memoryQueue = new Map<string, QueueItem>();
let useMemoryQueue = false;

/** Guards against overlapping drainQueue() runs. ShootApp calls it from
 * several independent triggers (right after enqueueing, the "online"
 * event, and a 6s poll) — without this, two runs can each snapshot the
 * queue via their own listAll() before either has marked an item
 * "uploading", so both pick up the same queued photo and upload it
 * twice. If a second call arrives while one is in flight, it's recorded
 * to run once more immediately after (rather than dropped), so an item
 * enqueued mid-drain still gets picked up promptly. */
let draining = false;
let rerunRequested = false;

/** Some browsers (Safari in particular) can fire an IDBRequest's
 * onerror with `request.error` left null/undefined — rejecting with
 * that directly produces an "Unhandled Promise Rejection: null" that
 * carries no information. Always reject with a real Error instead. */
function requestError(req: IDBRequest | IDBTransaction, fallbackMessage: string): Error {
  const domError = "error" in req ? req.error : null;
  return domError instanceof Error
    ? domError
    : new Error(domError ? String(domError) : fallbackMessage);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser context."));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (err) {
      reject(err instanceof Error ? err : new Error("Failed to open the offline queue database."));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(requestError(req, "Failed to open the offline queue database."));
    req.onblocked = () => reject(new Error("Offline queue database is blocked (open in another tab?)."));
  });
}

export async function enqueue(item: Omit<QueueItem, "status" | "attempts">): Promise<void> {
  const queuedItem: QueueItem = { ...item, status: "queued", attempts: 0 };
  if (useMemoryQueue) {
    memoryQueue.set(item.id, queuedItem);
    return;
  }
  try {
    const record = await toStoredRecord(queuedItem);
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(requestError(tx, "Failed to save to the offline queue."));
    });
  } catch (err) {
    // Private browsing can expose IndexedDB but reject writes. Keep this
    // session usable; a normal browser still gets durable offline retry.
    useMemoryQueue = true;
    memoryQueue.set(item.id, queuedItem);
    console.warn("[offlineQueue] persistent storage unavailable; using a session-only queue:", err);
  }
}

export async function updateStatus(
  id: string,
  status: QueueItemStatus,
  opts?: { lastError?: string; attempts?: number }
): Promise<void> {
  if (useMemoryQueue) {
    const record = memoryQueue.get(id);
    if (record) {
      memoryQueue.set(id, {
        ...record,
        status,
        lastError: opts?.lastError,
        attempts: opts?.attempts ?? record.attempts,
      });
    }
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (record) {
        store.put({
          ...record,
          status,
          lastError: opts?.lastError,
          attempts: opts?.attempts ?? record.attempts,
        });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(requestError(tx, "Failed to update the offline queue."));
  });
}

export async function remove(id: string): Promise<void> {
  if (useMemoryQueue) {
    memoryQueue.delete(id);
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(requestError(tx, "Failed to remove from the offline queue."));
  });
}

/** Manually stop and remove a queue item, regardless of its status.
 * If it's genuinely mid-upload (an AbortController is registered for
 * it), abort the in-flight request too — otherwise this just clears a
 * queued/failed/stuck row that would never leave on its own, including
 * one left permanently "uploading" by a page reload that happened
 * mid-request (drainQueue never revisits that status on its own). */
export async function cancelItem(id: string): Promise<void> {
  activeUploads.get(id)?.abort();
  await remove(id);
}

export async function listAll(): Promise<QueueItem[]> {
  if (useMemoryQueue) return [...memoryQueue.values()];
  const db = await openDb();
  const records = await new Promise<StoredQueueRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as StoredQueueRecord[]);
    req.onerror = () => reject(requestError(req, "Failed to read the offline queue."));
  });
  return records.map(toQueueItem);
}

/** Attempts every queued/failed item once. Safe to call repeatedly —
 * items already mid-upload are skipped. Never throws: this runs on a
 * background interval (see ShootApp), so a failure here (e.g. the
 * queue database is temporarily unavailable) is logged and skipped
 * rather than surfacing as an unhandled rejection. */
export async function drainQueue(onChange?: () => void): Promise<void> {
  if (draining) {
    rerunRequested = true;
    return;
  }
  draining = true;
  try {
    await drainQueueOnce(onChange);
    while (rerunRequested) {
      rerunRequested = false;
      await drainQueueOnce(onChange);
    }
  } finally {
    draining = false;
  }
}

/** POSTs JSON and returns the parsed response, translating both a
 * network-level failure and a non-2xx response into the same
 * UploadAttemptError distinction drainQueueOnce's retry logic expects.
 * `step` is prefixed onto the error message (shown in the UI as
 * "Failed — will retry (...)") so which of the three upload steps
 * broke is visible without opening devtools. */
async function postJson(step: string, url: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (networkErr) {
    const message = networkErr instanceof Error ? networkErr.message : "Network error";
    throw new UploadAttemptError(`${step}: ${message}`, true);
  }
  if (!res.ok) {
    const message = (await res.json().catch(() => ({}))).error ?? "Upload failed";
    throw new UploadAttemptError(`${step}: ${message}`, false);
  }
  return res.json();
}

/** Chunk size for POST .../photos/chunk. Must be a multiple of 256 KiB
 * per Google Drive's resumable-upload protocol (every chunk but the
 * last has to be) — 3 MiB comfortably clears that and Vercel's
 * ~4.5MB request body cap, with headroom for the multipart wrapper. */
const CHUNK_SIZE = 3 * 1024 * 1024;

/** Same request/response shape as postJson, but for a multipart
 * (file-carrying) POST — used to send one upload chunk. */
async function postForm(step: string, url: string, form: FormData, signal: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form, signal });
  } catch (networkErr) {
    const message = networkErr instanceof Error ? networkErr.message : "Network error";
    throw new UploadAttemptError(`${step}: ${message}`, true);
  }
  if (!res.ok) {
    const message = (await res.json().catch(() => ({}))).error ?? "Upload failed";
    throw new UploadAttemptError(`${step}: ${message}`, false);
  }
  return res.json();
}

async function drainQueueOnce(onChange?: () => void): Promise<void> {
  let items: QueueItem[];
  try {
    items = await listAll();
  } catch (err) {
    console.warn("[offlineQueue] could not read the queue, will retry later:", err);
    return;
  }

  for (const item of items) {
    if (item.status === "uploading" || item.status === "done" || item.status === "stuck") continue;

    const controller = new AbortController();
    activeUploads.set(item.id, controller);
    try {
      await updateStatus(item.id, "uploading");
      onChange?.();

      // Open a Drive upload session, send the file to *our own server*
      // in same-origin chunks (never a direct browser-to-Drive request
      // — see photos/init's doc comment for why), then tell the server
      // to pull the assembled file back down and process it.
      const contentType = item.blob.type || "image/jpeg";
      const { uploadUrl, rawKey } = (await postJson(
        "starting upload",
        `/api/events/${item.eventSlug}/photos/init`,
        { preset: item.preset, contentType },
        controller.signal
      )) as { uploadUrl: string; rawKey: string };

      const total = item.blob.size;
      let start = 0;
      let chunkNumber = 1;
      while (start < total) {
        const end = Math.min(start + CHUNK_SIZE, total);
        const form = new FormData();
        form.append("uploadUrl", uploadUrl);
        form.append("start", String(start));
        form.append("total", String(total));
        form.append("chunk", item.blob.slice(start, end), item.fileName);
        await postForm(
          `sending chunk ${chunkNumber}`,
          `/api/events/${item.eventSlug}/photos/chunk`,
          form,
          controller.signal
        );
        start = end;
        chunkNumber++;
      }

      await postJson(
        "finishing upload",
        `/api/events/${item.eventSlug}/photos/complete`,
        { preset: item.preset, rawKey, contentType },
        controller.signal
      );

      await remove(item.id);
    } catch (err) {
      const transient = err instanceof UploadAttemptError ? err.transient : true;
      const message = err instanceof Error ? err.message : "Upload failed";
      const attempts = transient ? item.attempts : item.attempts + 1;

      if (!transient && attempts >= MAX_SERVER_ATTEMPTS) {
        console.warn(`[offlineQueue] item ${item.id} failed ${attempts} times, giving up:`, message);
        try {
          await updateStatus(item.id, "stuck", { lastError: message, attempts });
        } catch (statusErr) {
          console.warn("[offlineQueue] could not record stuck status:", statusErr);
        }
      } else {
        console.warn(`[offlineQueue] item ${item.id} failed, will retry:`, message);
        try {
          await updateStatus(item.id, "failed", { lastError: message, attempts });
        } catch (statusErr) {
          console.warn("[offlineQueue] could not record failed status:", statusErr);
        }
      }
    } finally {
      activeUploads.delete(item.id);
    }
    onChange?.();
  }
}
