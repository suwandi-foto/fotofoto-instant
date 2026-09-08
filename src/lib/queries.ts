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
  type Tier,
  type Preset,
  type PresetId,
  type FeedbackScoreSegment,
} from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { generateId, generateSlug, generateVoucherCode } from "./ids";
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
    where: and(eq(photos.eventId, eventId), eq(photos.status, "live")),
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
