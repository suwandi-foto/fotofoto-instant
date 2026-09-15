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
  photoAnnotations,
  photoReactions,
  videoNotes,
  videoReviews,
  adminFeedback,
  clientDeliverables,
  eventDeliverables,
  type Tier,
  type Preset,
  type PresetId,
  type PhotoKind,
  type FeedbackScoreSegment,
  type VideoReviewStatus,
  type RelationshipStage,
  type DeliverableStatus,
} from "@/db/schema";
import { eq, and, asc, desc, isNull } from "drizzle-orm";
import { generateId, generateSlug, generateVoucherCode } from "./ids";
import type { ColorStats } from "./image";

/** Drizzle wraps the underlying driver's Postgres error in its own
 * DrizzleQueryError, so `code`/`constraint` live on `err.cause`, not
 * on `err` itself — checking `err.code` directly is always undefined
 * and silently defeats every unique-violation retry/handling below. */
export function pgError(err: unknown): { code?: string; constraint?: string } {
  const cause = (err as { cause?: { code?: string; constraint?: string } }).cause;
  return { code: cause?.code, constraint: cause?.constraint };
}

export async function createEvent(input: {
  name: string;
  clientName: string;
  tier: Tier;
  quota?: number;
  clientId?: string;
}) {
  const id = generateId();
  const slug = generateSlug();
  await db.insert(events).values({
    id,
    slug,
    name: input.name,
    clientName: input.clientName,
    clientId: input.clientId,
    tier: input.tier,
    quota: input.tier === "select" ? input.quota ?? 20 : 0,
    // Set explicitly rather than relying on the column's DB-level
    // default, so a newly-added builtin preset (like "original") shows
    // up for events created right after a deploy, without depending on
    // a schema migration having already run against the database.
    enabledBuiltinPresets: JSON.stringify(presetEnum),
  });
  // No selections row created here anymore — that's now owned by a
  // deliverable (see createDeliverable below), since tier/quota (and
  // therefore whether a select-tier selection exists) is per-deliverable,
  // not per-event. POST /api/events creates the event's first
  // deliverable right after calling this.
  return getEventBySlug(slug);
}

/**
 * One named, independently-tiered gallery within an event (see
 * eventDeliverables' doc comment in schema.ts). Mirrors what
 * createEvent used to do for tier="select": also opens the matching
 * selections row, since a select-tier deliverable is unusable without
 * one.
 */
export async function createDeliverable(
  eventId: string,
  input: { name: string; tier: Tier; quota?: number; extraUnitNote?: string }
) {
  const id = generateId();
  await db.insert(eventDeliverables).values({
    id,
    eventId,
    name: input.name,
    tier: input.tier,
    quota: input.tier === "select" ? input.quota ?? 20 : 0,
    ...(input.extraUnitNote !== undefined ? { extraUnitNote: input.extraUnitNote } : {}),
  });
  if (input.tier === "select") {
    await db.insert(selections).values({ id: generateId(), deliverableId: id });
  }
  return getDeliverable(id);
}

export async function listEventDeliverables(eventId: string) {
  return db.query.eventDeliverables.findMany({
    where: eq(eventDeliverables.eventId, eventId),
    orderBy: asc(eventDeliverables.createdAt),
  });
}

export async function getDeliverable(id: string) {
  const deliverable = await db.query.eventDeliverables.findFirst({
    where: eq(eventDeliverables.id, id),
  });
  return deliverable ?? null;
}

export async function updateDeliverable(
  id: string,
  patch: Partial<{ name: string; tier: Tier; quota: number; status: DeliverableStatus }>
) {
  await db.update(eventDeliverables).set(patch).where(eq(eventDeliverables.id, id));
}

/** Cascades photos/selection/selectionItems via FK — same one-line
 * pattern as deleteEvent. Caller is responsible for cleaning up this
 * deliverable's storage objects first (storage keys are eventId-keyed,
 * not deliverable-keyed, so that cleanup can't be a simple prefix
 * delete — see the deliverables DELETE route). */
export async function deleteDeliverable(id: string) {
  await db.delete(eventDeliverables).where(eq(eventDeliverables.id, id));
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

/** Deliverable-scoped counterpart of listEventPhotos above — what the
 * gallery actually renders per deliverable section/tab now. */
export async function listDeliverablePhotos(deliverableId: string) {
  return db.query.photos.findMany({
    where: and(
      eq(photos.deliverableId, deliverableId),
      eq(photos.status, "live"),
      eq(photos.kind, "photo")
    ),
    orderBy: desc(photos.uploadedAt),
  });
}

/** Deliverable-scoped counterpart of listEventVideos below. */
export async function listDeliverableVideos(deliverableId: string) {
  return db.query.photos.findMany({
    where: and(
      eq(photos.deliverableId, deliverableId),
      eq(photos.status, "live"),
      eq(photos.kind, "video")
    ),
    orderBy: desc(photos.uploadedAt),
  });
}

/** Every photo/video row for a deliverable regardless of status or
 * kind — unlike listDeliverablePhotos/listDeliverableVideos (live +
 * one kind only, for gallery display), this is for deleting a
 * deliverable: storage keys are eventId-prefixed, not
 * deliverable-prefixed (see photos.deliverableId's schema comment),
 * so there's no folder-prefix shortcut — every one of this
 * deliverable's photo rows (queued/failed included) has to be found
 * and its individual storage objects removed one by one. */
export async function listAllDeliverablePhotos(deliverableId: string) {
  return db.query.photos.findMany({ where: eq(photos.deliverableId, deliverableId) });
}

export async function getPhoto(photoId: string) {
  return db.query.photos.findFirst({ where: eq(photos.id, photoId) });
}

/**
 * Same lookup as getPhoto, plus the owning event's clientId — every
 * logged-in-only photo/video route (annotations, reactions, video
 * notes, video decisions) needs this to check that the calling contact
 * actually belongs to the client this photo's event is linked to, not
 * just that *some* contact is logged in. Without it, any logged-in
 * contact could read or write another client's annotations/notes/
 * decisions by guessing a photo/video id — see the client-scoping pass
 * this was added under.
 */
export async function getPhotoWithEventClientId(photoId: string) {
  const photo = await db.query.photos.findFirst({
    where: eq(photos.id, photoId),
    with: { event: { columns: { clientId: true } } },
  });
  return photo ?? null;
}

export async function createQueuedPhoto(
  eventId: string,
  deliverableId: string,
  preset: PresetId,
  kind: PhotoKind = "photo"
) {
  // Postgres can't express "deliverableId's own eventId must match the
  // eventId also being written here" as a constraint (photos denormalizes
  // both — see schema.ts's comment on photos.deliverableId) — enforced
  // here instead, once, for every caller.
  const deliverable = await getDeliverable(deliverableId);
  if (!deliverable || deliverable.eventId !== eventId) {
    throw new Error(`Deliverable '${deliverableId}' does not belong to event '${eventId}'.`);
  }
  const id = generateId();
  await db.insert(photos).values({ id, eventId, deliverableId, preset, kind, status: "queued" });
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
    thumbnailPath?: string;
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
      ...(data.thumbnailPath ? { thumbnailPath: data.thumbnailPath } : {}),
      uploadedAt: new Date().toISOString(),
    })
    .where(eq(photos.id, photoId));
}

/** Video-only intermediate state: the original file and a grid
 * thumbnail are stored (both fast), but the watermarked preview
 * rendition is still transcoding in the background (see POST
 * .../photos/complete's after() call) — markPhotoLive finishes the
 * job once that's done, or markPhotoFailed if it errors out. */
export async function markPhotoProcessing(
  photoId: string,
  data: { originalPath: string; thumbnailPath: string; width: number; height: number; orientation: string }
) {
  await db
    .update(photos)
    .set({
      status: "processing",
      originalPath: data.originalPath,
      thumbnailPath: data.thumbnailPath,
      width: data.width,
      height: data.height,
      orientation: data.orientation,
      uploadedAt: new Date().toISOString(),
    })
    .where(eq(photos.id, photoId));
}

/** Live videos for an event's gallery — kept separate from
 * listEventPhotos (which stays photo-only) rather than merging the two
 * kinds into one query/array, so the existing select-tier
 * quota/selection logic (photo-only) never has to account for videos
 * mixed into its counts. */
export async function listEventVideos(eventId: string) {
  return db.query.photos.findMany({
    where: and(eq(photos.eventId, eventId), eq(photos.status, "live"), eq(photos.kind, "video")),
    orderBy: desc(photos.uploadedAt),
  });
}

export async function markPhotoFailed(photoId: string) {
  await db.update(photos).set({ status: "failed" }).where(eq(photos.id, photoId));
}

export async function getSelectionForDeliverable(deliverableId: string) {
  const selection = await db.query.selections.findFirst({
    where: eq(selections.deliverableId, deliverableId),
    with: { items: true },
  });
  return selection ?? null;
}

export async function toggleSelectionItem(deliverableId: string, photoId: string) {
  const selection = await db.query.selections.findFirst({
    where: eq(selections.deliverableId, deliverableId),
  });
  if (!selection) throw new Error("This deliverable has no selection (not a select-tier deliverable).");
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

export async function finalizeSelection(deliverableId: string) {
  const selection = await db.query.selections.findFirst({
    where: eq(selections.deliverableId, deliverableId),
  });
  if (!selection) throw new Error("This deliverable has no selection (not a select-tier deliverable).");
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
  freeText?: string | null;
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
    freeText: input.freeText ?? null,
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
      if (pgError(err).code !== "23505" || attempt === maxAttempts) throw err;
    }
  }
  throw new Error("Could not generate a unique voucher code.");
}

export async function getClientById(id: string) {
  const row = await db.query.clients.findFirst({ where: eq(clients.id, id) });
  return row ?? null;
}

/** Staff-facing creation path — see POST /api/admin/clients. The
 * access code is always supplied by the caller (staff, typed directly
 * or via fotofoto-ops) rather than generated in here — see
 * upsertClientFromOps below for the fotofoto-ops-driven path. */
export async function createClient(input: {
  companyName: string;
  accessCode: string;
  opsClientId?: string | null;
  relationshipStage?: RelationshipStage;
}) {
  const id = generateId();
  await db.insert(clients).values({
    id,
    companyName: input.companyName,
    accessCode: input.accessCode,
    opsClientId: input.opsClientId ?? null,
    relationshipStage: input.relationshipStage ?? "foundation",
  });
  return getClientById(id);
}

export async function listClients() {
  return db.query.clients.findMany({ orderBy: desc(clients.createdAt) });
}

export async function setClientRelationshipStage(clientId: string, stage: RelationshipStage) {
  await db.update(clients).set({ relationshipStage: stage }).where(eq(clients.id, clientId));
}

export async function setClientAccessCode(clientId: string, accessCode: string) {
  await db.update(clients).set({ accessCode }).where(eq(clients.id, clientId));
}

/** Case-sensitive, trim-only lookup. Unlike the old per-contact codes
 * (auto-generated for reading aloud over WhatsApp, hence
 * case-insensitive), this is a password a human deliberately types
 * once into fotofoto-ops — an ordinary case-sensitive credential. */
export async function getClientByAccessCode(accessCode: string) {
  const row = await db.query.clients.findFirst({
    where: eq(clients.accessCode, accessCode.trim()),
  });
  return row ?? null;
}

export async function getClientByOpsClientId(opsClientId: string) {
  const row = await db.query.clients.findFirst({ where: eq(clients.opsClientId, opsClientId) });
  return row ?? null;
}

export class AccessCodeConflictError extends Error {}

export type OpsDeliverable = {
  project: string;
  type: string;
  description: string;
  status: string;
};

/** Swaps in exactly this list for the client — ops always sends its
 * full current deliverables list, not a diff, so every previous row is
 * dropped rather than merged. Not wrapped in a transaction (the
 * neon-http driver call site here has no other precedent for one in
 * this file); a request landing mid-swap just sees a briefly shorter
 * list, which is acceptable for this informational, staff-repushed-only
 * data. */
async function replaceClientDeliverables(clientId: string, deliverables: OpsDeliverable[]) {
  await db.delete(clientDeliverables).where(eq(clientDeliverables.clientId, clientId));
  if (deliverables.length === 0) return;
  await db.insert(clientDeliverables).values(
    deliverables.map((d) => ({
      id: generateId(),
      clientId,
      project: d.project,
      type: d.type,
      description: d.description,
      status: d.status,
    }))
  );
}

/**
 * The fotofoto-ops-driven provisioning path — see POST
 * /api/ops/clients. `opsClientId` is the idempotency key: a repeat
 * call for the same fotofoto-ops client updates the existing row
 * (companyName/accessCode unconditionally; relationshipStage only if
 * given, so ops omitting it doesn't reset a staff-tuned value back to
 * "foundation") rather than creating a duplicate. Retries as an update
 * if a race loses the opsClientId uniqueness check; surfaces a
 * same-code-different-client collision as AccessCodeConflictError
 * rather than silently reassigning someone else's password.
 * `deliverables` defaults to empty so older ops deployments that don't
 * send the field yet behave the same as an explicit empty list.
 */
export async function upsertClientFromOps(input: {
  opsClientId: string;
  companyName: string;
  accessCode: string;
  relationshipStage?: RelationshipStage;
  deliverables?: OpsDeliverable[];
}): Promise<{ created: boolean; client: NonNullable<Awaited<ReturnType<typeof getClientById>>> }> {
  const deliverables = input.deliverables ?? [];
  const existing = await getClientByOpsClientId(input.opsClientId);

  if (existing) {
    try {
      await db
        .update(clients)
        .set({
          companyName: input.companyName,
          accessCode: input.accessCode,
          ...(input.relationshipStage ? { relationshipStage: input.relationshipStage } : {}),
        })
        .where(eq(clients.id, existing.id));
    } catch (err) {
      if (pgError(err).constraint === "clients_access_code_unique") throw new AccessCodeConflictError();
      throw err;
    }
    await replaceClientDeliverables(existing.id, deliverables);
    return { created: false, client: (await getClientById(existing.id))! };
  }

  try {
    const client = await createClient({
      companyName: input.companyName,
      accessCode: input.accessCode,
      opsClientId: input.opsClientId,
      relationshipStage: input.relationshipStage,
    });
    await replaceClientDeliverables(client!.id, deliverables);
    return { created: true, client: client! };
  } catch (err) {
    const constraint = pgError(err).constraint;
    if (constraint === "clients_ops_client_id_unique") {
      // Race: another request inserted this opsClientId between our
      // lookup and our insert — retry as an update.
      return upsertClientFromOps(input);
    }
    if (constraint === "clients_access_code_unique") throw new AccessCodeConflictError();
    throw err;
  }
}

export async function listClientEvents(clientId: string) {
  return db.query.events.findMany({
    where: eq(events.clientId, clientId),
    orderBy: desc(events.createdAt),
  });
}

/** Real deliverables (see eventDeliverables in schema.ts) across every
 * event linked to this client — what /library's Deliverables section
 * renders now, replacing the old ops-pushed free-text
 * listClientDeliverables above. Grouped by event, newest event first,
 * so the client's own view can section them the same way the old
 * ops-driven list grouped by "project". */
export async function listEventDeliverablesForClient(clientId: string) {
  const rows = await db.query.events.findMany({
    where: eq(events.clientId, clientId),
    orderBy: desc(events.createdAt),
    with: { deliverables: { orderBy: asc(eventDeliverables.createdAt) } },
  });
  return rows.map((e) => ({
    eventId: e.id,
    eventSlug: e.slug,
    eventName: e.name,
    deliverables: e.deliverables.map((d) => ({
      id: d.id,
      name: d.name,
      tier: d.tier,
      quota: d.quota,
      status: d.status,
    })),
  }));
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

/** Chronological (oldest-first) so the pin number shown in the photo
 * (1, 2, 3, ...) matches the order notes appear in the list below it. */
export async function listPhotoAnnotations(photoId: string) {
  return db.query.photoAnnotations.findMany({
    where: eq(photoAnnotations.photoId, photoId),
    orderBy: asc(photoAnnotations.createdAt),
  });
}

export async function createPhotoAnnotation(input: {
  photoId: string;
  clientId: string;
  xPct: number;
  yPct: number;
  note: string;
}) {
  const id = generateId();
  await db.insert(photoAnnotations).values({
    id,
    photoId: input.photoId,
    clientId: input.clientId,
    xPct: input.xPct,
    yPct: input.yPct,
    note: input.note,
  });
  return id;
}

export async function getPhotoReactionSummary(photoId: string, clientId: string | null) {
  // Reactions per photo are bounded by realistic traffic at this
  // scale, so loading every row to count and check membership is
  // simpler than a separate aggregate query and plenty fast.
  const rows = await db.query.photoReactions.findMany({
    where: eq(photoReactions.photoId, photoId),
  });
  return {
    count: rows.length,
    liked: clientId != null && rows.some((r) => r.clientId === clientId),
  };
}

/** Toggle is a plain check-then-act, made safe against a double-tap
 * race by the table's (photo_id, client_id) unique index: if two
 * requests both see "not yet liked" and both try to insert, the
 * second's insert hits 23505 and is treated as "already liked" rather
 * than surfaced as an error. */
export async function togglePhotoReaction(photoId: string, clientId: string) {
  const existing = await db.query.photoReactions.findFirst({
    where: and(eq(photoReactions.photoId, photoId), eq(photoReactions.clientId, clientId)),
  });

  if (existing) {
    await db.delete(photoReactions).where(eq(photoReactions.id, existing.id));
  } else {
    try {
      await db.insert(photoReactions).values({ id: generateId(), photoId, clientId });
    } catch (err) {
      if (pgError(err).code !== "23505") throw err;
    }
  }

  return getPhotoReactionSummary(photoId, clientId);
}

/** Chronological by in-video timestamp (not createdAt) so notes line
 * up with their marks left-to-right along the scrub bar. */
export async function listVideoNotes(photoId: string) {
  return db.query.videoNotes.findMany({
    where: eq(videoNotes.photoId, photoId),
    orderBy: asc(videoNotes.timestampSeconds),
  });
}

export async function createVideoNote(input: {
  photoId: string;
  clientId: string;
  timestampSeconds: number;
  note: string;
}) {
  const id = generateId();
  await db.insert(videoNotes).values({
    id,
    photoId: input.photoId,
    clientId: input.clientId,
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
  });
  if (existing) return existing;

  await db.insert(videoReviews).values({ photoId }).onConflictDoNothing({
    target: videoReviews.photoId,
  });
  return (await db.query.videoReviews.findFirst({
    where: eq(videoReviews.photoId, photoId),
  }))!;
}

/**
 * Records the client's decision, but only once: the UPDATE is
 * conditioned on the row still being `awaiting_notes`, so a race
 * between two requests deciding at once can't leave the row in an
 * inconsistent state, and a second decision attempt after the first
 * has already landed is rejected (returns null) rather than silently
 * overwriting it. There's no staff/admin auth model in this app to
 * carve out a legitimate "override" actor, so once decided, it's
 * final from here. No caller identity is recorded — ownership is
 * already checked at the route level before this is called, and there
 * is nowhere left to attribute a decision to (see the login-model
 * refactor that dropped decidedByContactId).
 */
export async function decideVideoReview(photoId: string, decision: "approve" | "revise") {
  await getOrCreateVideoReview(photoId);

  const status: VideoReviewStatus = decision === "approve" ? "approved" : "revision_requested";
  const [updated] = await db
    .update(videoReviews)
    .set({ status, decidedAt: new Date().toISOString() })
    .where(and(eq(videoReviews.photoId, photoId), eq(videoReviews.status, "awaiting_notes")))
    .returning();

  return updated ?? null;
}

/** Staff-only — see POST /api/admin/feedback and schema.ts's
 * adminFeedback comment. */
export async function createAdminFeedback(input: { authorLabel: string; text: string }) {
  const id = generateId();
  await db.insert(adminFeedback).values({ id, authorLabel: input.authorLabel, text: input.text });
  return db.query.adminFeedback.findFirst({ where: eq(adminFeedback.id, id) });
}

export async function listAdminFeedback() {
  return db.query.adminFeedback.findMany({ orderBy: desc(adminFeedback.createdAt) });
}

/**
 * Every video with at least one un-addressed revision note, across
 * every event — the admin triage view's whole reason for existing (see
 * /admin/video-notes): today a staff member would otherwise have to
 * open each event/video individually to find these. Loads all
 * candidate videos + their pending notes in two queries rather than
 * one per video, since the number of in-review videos at once is small.
 */
export async function listVideosWithPendingNotes() {
  const pendingNotes = await db.query.videoNotes.findMany({
    where: isNull(videoNotes.addressedAt),
    orderBy: asc(videoNotes.timestampSeconds),
  });
  if (pendingNotes.length === 0) return [];

  const videoIds = [...new Set(pendingNotes.map((n) => n.photoId))];
  const videoRows = await db.query.photos.findMany({
    where: and(eq(photos.kind, "video")),
    with: { event: true },
  });
  const byId = new Map(videoRows.map((v) => [v.id, v]));

  const grouped = new Map<string, typeof pendingNotes>();
  for (const note of pendingNotes) {
    if (!byId.has(note.photoId)) continue; // note on a deleted/non-video row
    const list = grouped.get(note.photoId) ?? [];
    list.push(note);
    grouped.set(note.photoId, list);
  }

  return videoIds
    .filter((id) => byId.has(id) && grouped.has(id))
    .map((id) => ({ video: byId.get(id)!, notes: grouped.get(id)! }));
}

export async function markVideoNoteAddressed(noteId: string) {
  await db
    .update(videoNotes)
    .set({ addressedAt: new Date().toISOString() })
    .where(eq(videoNotes.id, noteId));
}
