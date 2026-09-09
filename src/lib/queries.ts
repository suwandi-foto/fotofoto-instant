import { db } from "@/db/client";
import {
  events,
  photos,
  selections,
  selectionItems,
  customPresets,
  presetEnum,
  feedback,
  referrals,
  clients,
  clientContacts,
  authTokens,
  photoAnnotations,
  photoReactions,
  videoNotes,
  videoReviews,
  type Tier,
  type Preset,
  type PresetId,
  type FeedbackScoreSegment,
  type VideoReviewStatus,
} from "@/db/schema";
import { eq, and, asc, desc, isNull } from "drizzle-orm";
import { generateId, generateSlug, generateVoucherCode, generateAuthToken } from "./ids";
import type { ColorStats } from "./image";

export async function createEvent(input: {
  name: string;
  clientName: string;
  tier: Tier;
  quota?: number;
}) {
  const id = generateId();
  const slug = generateSlug();
  await db.insert(events).values({
    id,
    slug,
    name: input.name,
    clientName: input.clientName,
    tier: input.tier,
    quota: input.tier === "select" ? input.quota ?? 20 : 0,
    // Set explicitly rather than relying on the column's DB-level
    // default, so a newly-added builtin preset (like "original") shows
    // up for events created right after a deploy, without depending on
    // a schema migration having already run against the database.
    enabledBuiltinPresets: JSON.stringify(presetEnum),
  });
  if (input.tier === "select") {
    await db.insert(selections).values({ id: generateId(), eventId: id });
  }
  return getEventBySlug(slug);
}

export async function getEventBySlug(slug: string) {
  const event = await db.query.events.findFirst({ where: eq(events.slug, slug) });
  return event ?? null;
}

/** Deletes the event row; photos, selections, and selection_items all
 * cascade via their `onDelete: "cascade"` foreign keys (see schema.ts).
 * Storage objects (originals/previews/preset references) live outside
 * the DB and are cleaned up separately — see deleteEventObjects. */
export async function deleteEvent(eventId: string) {
  await db.delete(events).where(eq(events.id, eventId));
}

export async function listEventPhotos(eventId: string) {
  return db.query.photos.findMany({
    // kind = "photo" excludes video rows, which don't belong in the
    // photo gallery grid — see Video Review, which lists those itself.
    where: and(eq(photos.eventId, eventId), eq(photos.status, "live"), eq(photos.kind, "photo")),
    orderBy: desc(photos.uploadedAt),
  });
}

export async function getPhoto(photoId: string) {
  return db.query.photos.findFirst({ where: eq(photos.id, photoId) });
}

export async function createQueuedPhoto(eventId: string, preset: PresetId) {
  const id = generateId();
  await db.insert(photos).values({ id, eventId, preset, status: "queued" });
  return id;
}

export async function markPhotoLive(
  photoId: string,
  data: {
    originalPath: string;
    previewPath: string;
    width: number;
    height: number;
    orientation: string;
  }
) {
  await db
    .update(photos)
    .set({
      status: "live",
      originalPath: data.originalPath,
      previewPath: data.previewPath,
      width: data.width,
      height: data.height,
      orientation: data.orientation,
      uploadedAt: new Date().toISOString(),
    })
    .where(eq(photos.id, photoId));
}

export async function markPhotoFailed(photoId: string) {
  await db.update(photos).set({ status: "failed" }).where(eq(photos.id, photoId));
}

export async function getSelectionForEvent(eventId: string) {
  const selection = await db.query.selections.findFirst({
    where: eq(selections.eventId, eventId),
    with: { items: true },
  });
  return selection ?? null;
}

export async function toggleSelectionItem(eventId: string, photoId: string) {
  const selection = await db.query.selections.findFirst({
    where: eq(selections.eventId, eventId),
  });
  if (!selection) throw new Error("This event has no selection (not a select-tier event).");
  if (selection.finalizedAt) throw new Error("Selection is already finalized.");

  const existing = await db.query.selectionItems.findFirst({
    where: and(
      eq(selectionItems.selectionId, selection.id),
      eq(selectionItems.photoId, photoId)
    ),
  });

  if (existing) {
    await db.delete(selectionItems).where(eq(selectionItems.id, existing.id));
    return { selected: false };
  } else {
    await db
      .insert(selectionItems)
      .values({ id: generateId(), selectionId: selection.id, photoId });
    return { selected: true };
  }
}

export async function finalizeSelection(eventId: string) {
  const selection = await db.query.selections.findFirst({
    where: eq(selections.eventId, eventId),
  });
  if (!selection) throw new Error("This event has no selection (not a select-tier event).");
  await db
    .update(selections)
    .set({ finalizedAt: new Date().toISOString() })
    .where(eq(selections.id, selection.id));
}

/** The built-in preset ids this event currently offers the
 * photographer app, in the studio-chosen order. Falls back to all
 * four if the stored JSON is ever missing/corrupt. */
export function parseEnabledBuiltinPresets(raw: string): Preset[] {
  try {
    const parsed = JSON.parse(raw);
    const valid = Array.isArray(parsed) ? parsed.filter((p): p is Preset => presetEnum.includes(p)) : [];
    return valid.length > 0 ? valid : [...presetEnum];
  } catch {
    return [...presetEnum];
  }
}

export async function setEnabledBuiltinPresets(eventId: string, ids: Preset[]) {
  const deduped = ids.filter((id, i) => presetEnum.includes(id) && ids.indexOf(id) === i);
  await db
    .update(events)
    .set({ enabledBuiltinPresets: JSON.stringify(deduped) })
    .where(eq(events.id, eventId));
}

export async function listCustomPresets(eventId: string) {
  return db.query.customPresets.findMany({
    where: eq(customPresets.eventId, eventId),
    orderBy: desc(customPresets.createdAt),
  });
}

export async function getCustomPreset(id: string) {
  const preset = await db.query.customPresets.findFirst({ where: eq(customPresets.id, id) });
  return preset ?? null;
}

/** The id is generated by the caller (rather than inside this
 * function) so its storage key — which embeds the id — can be derived
 * and written before this row is inserted. See POST
 * /api/events/[slug]/presets/custom. */
export async function createCustomPreset(
  id: string,
  eventId: string,
  name: string,
  referencePath: string,
  stats: ColorStats
) {
  await db.insert(customPresets).values({
    id,
    eventId,
    name,
    referencePath,
    statsMean: JSON.stringify(stats.mean),
    statsStd: JSON.stringify(stats.std),
  });
}

export async function setCustomPresetEnabled(id: string, enabled: boolean) {
  await db.update(customPresets).set({ enabled }).where(eq(customPresets.id, id));
}

/** Returns the deleted row (so the caller can clean up its storage
 * object) or null if it didn't exist. */
export async function deleteCustomPreset(id: string) {
  const preset = await getCustomPreset(id);
  if (!preset) return null;
  await db.delete(customPresets).where(eq(customPresets.id, id));
  return preset;
}

/** Everything the photographer app and Control Room need to render
 * the preset picker for one event: which built-ins are enabled (in
 * order) and the event's custom presets. */
export async function getEventPresetsConfig(event: { id: string; enabledBuiltinPresets: string }) {
  const builtins = parseEnabledBuiltinPresets(event.enabledBuiltinPresets);
  const custom = await listCustomPresets(event.id);
  return { builtins, custom };
}

export async function createFeedback(input: {
  eventId: string;
  score: number;
  segment: FeedbackScoreSegment;
  tags: string[];
  testimonialText?: string | null;
  testimonialConsent?: boolean;
}) {
  const id = generateId();
  await db.insert(feedback).values({
    id,
    eventId: input.eventId,
    score: input.score,
    segment: input.segment,
    tags: JSON.stringify(input.tags),
    testimonialText: input.testimonialText ?? null,
    testimonialConsent: input.testimonialConsent ?? false,
  });
  return getFeedback(id);
}

export async function getFeedback(id: string) {
  const row = await db.query.feedback.findFirst({ where: eq(feedback.id, id) });
  return row ?? null;
}

/** Generates a unique voucher code server-side and retries on the rare
 * unique-constraint collision rather than trusting a client-suppliable
 * code. Postgres unique_violation is error code 23505. */
export async function createReferral(input: {
  feedbackId: string;
  eventId: string;
  referredName: string;
  referredContact?: string | null;
}) {
  const id = generateId();
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const voucherCode = generateVoucherCode();
    try {
      await db.insert(referrals).values({
        id,
        feedbackId: input.feedbackId,
        eventId: input.eventId,
        referredName: input.referredName,
        referredContact: input.referredContact ?? null,
        voucherCode,
      });
      return db.query.referrals.findFirst({ where: eq(referrals.id, id) });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "23505" || attempt === maxAttempts) throw err;
    }
  }
  throw new Error("Could not generate a unique voucher code.");
}

export async function getClientById(id: string) {
  const row = await db.query.clients.findFirst({ where: eq(clients.id, id) });
  return row ?? null;
}

/** Dev-only path for now — see POST /api/dev/contacts. A real
 * "FOTOFOTO staff adds a client contact" UI is future work. */
export async function createClient(input: { companyName: string; opsClientId?: string | null }) {
  const id = generateId();
  await db.insert(clients).values({
    id,
    companyName: input.companyName,
    opsClientId: input.opsClientId ?? null,
  });
  return getClientById(id);
}

export async function getContactById(id: string) {
  const row = await db.query.clientContacts.findFirst({ where: eq(clientContacts.id, id) });
  return row ?? null;
}

export async function getContactByEmail(email: string) {
  const row = await db.query.clientContacts.findFirst({
    where: eq(clientContacts.email, email.toLowerCase()),
  });
  return row ?? null;
}

export async function createClientContact(input: {
  clientId: string;
  name: string;
  department: string;
  email: string;
}) {
  const id = generateId();
  await db.insert(clientContacts).values({
    id,
    clientId: input.clientId,
    name: input.name,
    department: input.department,
    email: input.email.toLowerCase(),
  });
  return getContactById(id);
}

export async function listClientEvents(clientId: string) {
  return db.query.events.findMany({
    where: eq(events.clientId, clientId),
    orderBy: desc(events.createdAt),
  });
}

// Matches design-reference/Main.dc.html's "Archives after 2 weeks"
// copy for the client library. Events have no separate "event date"
// field, so this is proxied off createdAt.
const EVENT_ARCHIVE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** Pulled out of the library page's render body — calling Date.now()
 * directly in a Server Component's render is flagged as an impure
 * render by this repo's eslint react-hooks/purity rule. */
export function isEventArchived(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > EVENT_ARCHIVE_AFTER_MS;
}

const AUTH_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes, same window as the rest of this pass's magic link

export async function createAuthToken(contactId: string) {
  const id = generateId();
  const token = generateAuthToken();
  const expiresAt = new Date(Date.now() + AUTH_TOKEN_TTL_MS).toISOString();
  await db.insert(authTokens).values({ id, contactId, token, expiresAt });
  return { token, expiresAt };
}

/**
 * Atomically single-use-consumes a token: the UPDATE only matches a
 * row that hasn't been consumed yet, so two concurrent requests for
 * the same token can never both succeed (no separate check-then-act
 * race). Expiry is checked afterward — an expired token still ends up
 * marked consumed (so it can never be retried either way) but is
 * rejected here same as an unknown or already-used one.
 */
export async function consumeAuthToken(token: string) {
  const [consumed] = await db
    .update(authTokens)
    .set({ consumedAt: new Date().toISOString() })
    .where(and(eq(authTokens.token, token), isNull(authTokens.consumedAt)))
    .returning();

  if (!consumed) return null;
  if (new Date(consumed.expiresAt).getTime() < Date.now()) return null;

  return getContactById(consumed.contactId);
}

/** Chronological (oldest-first) so the pin number shown in the photo
 * (1, 2, 3, ...) matches the order notes appear in the list below it. */
export async function listPhotoAnnotations(photoId: string) {
  return db.query.photoAnnotations.findMany({
    where: eq(photoAnnotations.photoId, photoId),
    orderBy: asc(photoAnnotations.createdAt),
    with: { contact: true },
  });
}

export async function createPhotoAnnotation(input: {
  photoId: string;
  contactId: string;
  xPct: number;
  yPct: number;
  note: string;
}) {
  const id = generateId();
  await db.insert(photoAnnotations).values({
    id,
    photoId: input.photoId,
    contactId: input.contactId,
    xPct: input.xPct,
    yPct: input.yPct,
    note: input.note,
  });
  return id;
}

export async function getPhotoReactionSummary(photoId: string, contactId: string | null) {
  // Reactions per photo are bounded by how many contacts a client has
  // (a handful, not a viral audience), so loading every row to count
  // and check membership is simpler than a separate aggregate query
  // and plenty fast at this scale.
  const rows = await db.query.photoReactions.findMany({
    where: eq(photoReactions.photoId, photoId),
  });
  return {
    count: rows.length,
    liked: contactId != null && rows.some((r) => r.contactId === contactId),
  };
}

/** Toggle is a plain check-then-act, made safe against a double-tap
 * race by the table's (photo_id, contact_id) unique index: if two
 * requests both see "not yet liked" and both try to insert, the
 * second's insert hits 23505 and is treated as "already liked" rather
 * than surfaced as an error. */
export async function togglePhotoReaction(photoId: string, contactId: string) {
  const existing = await db.query.photoReactions.findFirst({
    where: and(eq(photoReactions.photoId, photoId), eq(photoReactions.contactId, contactId)),
  });

  if (existing) {
    await db.delete(photoReactions).where(eq(photoReactions.id, existing.id));
  } else {
    try {
      await db.insert(photoReactions).values({ id: generateId(), photoId, contactId });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "23505") throw err;
    }
  }

  return getPhotoReactionSummary(photoId, contactId);
}

/** Chronological by in-video timestamp (not createdAt) so notes line
 * up with their marks left-to-right along the scrub bar. */
export async function listVideoNotes(photoId: string) {
  return db.query.videoNotes.findMany({
    where: eq(videoNotes.photoId, photoId),
    orderBy: asc(videoNotes.timestampSeconds),
    with: { contact: true },
  });
}

export async function createVideoNote(input: {
  photoId: string;
  contactId: string;
  timestampSeconds: number;
  note: string;
}) {
  const id = generateId();
  await db.insert(videoNotes).values({
    id,
    photoId: input.photoId,
    contactId: input.contactId,
    timestampSeconds: input.timestampSeconds,
    note: input.note,
  });
  return id;
}

/** A video's review row is created lazily on first read/write rather
 * than at upload time — there's no upload pipeline to hook that into
 * yet (see README.md's video note). */
export async function getOrCreateVideoReview(photoId: string) {
  const existing = await db.query.videoReviews.findFirst({
    where: eq(videoReviews.photoId, photoId),
    with: { decidedBy: true },
  });
  if (existing) return existing;

  await db.insert(videoReviews).values({ photoId }).onConflictDoNothing({
    target: videoReviews.photoId,
  });
  return (await db.query.videoReviews.findFirst({
    where: eq(videoReviews.photoId, photoId),
    with: { decidedBy: true },
  }))!;
}

/**
 * Records the client's decision, but only once: the UPDATE is
 * conditioned on the row still being `awaiting_notes`, so a race
 * between two contacts deciding at once can't leave the row in an
 * inconsistent state, and a second decision attempt after the first
 * has already landed is rejected (returns null) rather than silently
 * overwriting it. There's no staff/admin auth model in this app to
 * carve out a legitimate "override" actor, so once decided, it's
 * final from here.
 */
export async function decideVideoReview(
  photoId: string,
  contactId: string,
  decision: "approve" | "revise"
) {
  await getOrCreateVideoReview(photoId);

  const status: VideoReviewStatus = decision === "approve" ? "approved" : "revision_requested";
  const [updated] = await db
    .update(videoReviews)
    .set({ status, decidedAt: new Date().toISOString(), decidedByContactId: contactId })
    .where(and(eq(videoReviews.photoId, photoId), eq(videoReviews.status, "awaiting_notes")))
    .returning();

  return updated ?? null;
}
