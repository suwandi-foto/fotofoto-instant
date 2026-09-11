/**
 * FOTOFOTO Instant Event Photo Delivery — data model.
 *
 * Postgres (see src/db/client.ts), per the confirmed production
 * stack. Timestamp columns are plain `text` holding ISO strings
 * (via $defaultFn) rather than native `timestamp` columns — keeps the
 * JS-side type a plain string everywhere the app already expects one,
 * with no dialect-specific default-expression casting to worry about.
 */
import { pgTable, text, integer, boolean, doublePrecision, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

const isoNow = () => new Date().toISOString();

export const tierEnum = ["full_access", "select"] as const;
export type Tier = (typeof tierEnum)[number];

export const photoStatusEnum = [
  "queued", // captured on phone, not yet uploaded
  "uploading",
  "processing", // server generating preview + storing original
  "live", // visible in the gallery
  "failed",
] as const;
export type PhotoStatus = (typeof photoStatusEnum)[number];

export const presetEnum = ["original", "warm", "bright", "bw", "contrast"] as const;
export type Preset = (typeof presetEnum)[number];

/** A photo's preset is either one of the built-in ids above, or a
 * custom preset the studio uploaded for that event, referenced as
 * `custom:<customPresets.id>`. Stored as plain text (no DB enum) so
 * new custom preset ids never require a schema change. */
export type PresetId = string;

/**
 * One Event = one QR code = one tier. Created at booking time from a
 * Package (which sets the tier + quota). No login is associated with
 * an event; the slug (used in the QR/link) is the access credential.
 */
export const events = pgTable("events", {
  id: text("id").primaryKey(), // nanoid
  slug: text("slug").notNull().unique(), // short id used in the QR/link URL
  name: text("name").notNull(),
  clientName: text("client_name").notNull(),
  // Nullable: structured link to the `clients` table below, for events
  // whose client has a logged-in contact (Photo Detail/Video Review).
  // `clientName` above stays as the studio's free-text label and is
  // not derived from this — plenty of events have no client contact
  // at all and only ever use the QR/link, which is staying intact.
  clientId: text("client_id").references(() => clients.id),
  tier: text("tier", { enum: tierEnum }).notNull(),
  quota: integer("quota").notNull().default(0), // only meaningful for tier = select
  extraUnitNote: text("extra_unit_note").default(
    "Extra photos are invoiced separately by our team after the event."
  ),
  // JSON array of presetEnum ids the photographer app offers for this
  // event, e.g. '["warm","bw"]' — lets the studio trim the built-in
  // list per event instead of always showing all four.
  enabledBuiltinPresets: text("enabled_builtin_presets")
    .notNull()
    .default('["original","warm","bright","bw","contrast"]'),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(isoNow),
});

export const photoKindEnum = ["photo", "video"] as const;
export type PhotoKind = (typeof photoKindEnum)[number];

/**
 * A single captured, processed photo (or video — see `kind`) belonging
 * to one event.
 * - previewPath: compressed rendition (~1000px WebP for a photo; for a
 *   video, a low-res watermarked file — see the video transcoding
 *   pipeline note in README.md, not built as of this table's addition).
 *   What every gallery view loads.
 * - originalPath: untouched full-resolution file. Only ever served by
 *   the download endpoints, never embedded directly in a gallery page.
 */
export const photos = pgTable("photos", {
  id: text("id").primaryKey(), // nanoid
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: photoKindEnum }).notNull().default("photo"),
  preset: text("preset").notNull(), // a Preset id, or "custom:<customPresets.id>"
  status: text("status", { enum: photoStatusEnum }).notNull().default("queued"),
  originalPath: text("original_path"), // set once the original is stored
  previewPath: text("preview_path"), // set once the preview is generated (photo: WebP image; video: watermarked low-res MP4)
  // Video-only: a single still frame (JPEG) for the gallery grid tile —
  // previewPath for a video is playable media, not something an <img>
  // can render, so the grid needs a separate static thumbnail. Always
  // null for kind = "photo" (previewPath already is an image there).
  thumbnailPath: text("thumbnail_path"),
  width: integer("width"),
  height: integer("height"),
  orientation: text("orientation"), // "portrait" | "landscape" | "square" — drives the masonry tile ratio
  capturedAt: text("captured_at")
    .notNull()
    .$defaultFn(isoNow),
  uploadedAt: text("uploaded_at"),
});

/**
 * One shared selection per select-tier event (owned by the client
 * link holder, not per-guest — confirmed decision). Full-access
 * events never have a selections row.
 */
export const selections = pgTable("selections", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" })
    .unique(),
  finalizedAt: text("finalized_at"), // null until the client hits "Finalize Selection"
});

/**
 * A studio-uploaded custom "look," scoped to one event. Instead of a
 * real LUT/graded file, we store a reference photo's color statistics
 * (mean/stdev per RGB channel — see computeColorStats in image.ts) and
 * match every captured photo's color to it at processing time. Cheap
 * and approximate, in the same spirit as the four built-in presets in
 * image.ts, but lets the studio create a new "look" without touching
 * code — just upload a photo whose mood they want to match.
 */
export const customPresets = pgTable("custom_presets", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  referencePath: text("reference_path").notNull(), // storage key for the reference thumbnail
  statsMean: text("stats_mean").notNull(), // JSON "[r,g,b]"
  statsStd: text("stats_std").notNull(), // JSON "[r,g,b]"
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(isoNow),
});

export const selectionItems = pgTable("selection_items", {
  id: text("id").primaryKey(),
  selectionId: text("selection_id")
    .notNull()
    .references(() => selections.id, { onDelete: "cascade" }),
  photoId: text("photo_id")
    .notNull()
    .references(() => photos.id, { onDelete: "cascade" }),
  tickedAt: text("ticked_at")
    .notNull()
    .$defaultFn(isoNow),
});

/**
 * Client record — also the login boundary: one shared, staff-chosen
 * `accessCode` per client company (not per named person). The code is
 * typed by staff directly into fotofoto-ops when a lead becomes a
 * client, then pushed here via POST /api/ops/clients (see that route
 * and upsertClientFromOps in queries.ts) — this app never generates
 * one itself. `opsClientId` is a real, unique idempotency key for that
 * inbound call, not just a loose reference: it's how repeat/retried
 * calls for the same fotofoto-ops client resolve to the same row here
 * instead of creating a duplicate.
 */
export const relationshipStageEnum = ["foundation", "growth_partner", "enterprise"] as const;
export type RelationshipStage = (typeof relationshipStageEnum)[number];

export const clients = pgTable("clients", {
  id: text("id").primaryKey(),
  companyName: text("company_name").notNull(),
  opsClientId: text("ops_client_id").unique(), // idempotency key for POST /api/ops/clients
  accessCode: text("access_code").notNull().unique(),
  // Gates the Communication Health card (see EntryCards.tsx) — that
  // page lives entirely in fotofoto-ops (real MCMM/ACTR data already
  // exists there; see that repo's mcmm_sessions/communication_health_data),
  // so this only controls whether this app treats the client as
  // entitled to it, not any data about the score itself. Staff-set only
  // — no client-facing editor, by design.
  relationshipStage: text("relationship_stage", { enum: relationshipStageEnum })
    .notNull()
    .default("foundation"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(isoNow),
});

/**
 * A pinned note on one exact spot of a photo — Photo Detail's
 * annotation feature. `xPct`/`yPct` (0-100) are relative to the
 * image's own dimensions, not pixels, so a pin stays correctly placed
 * regardless of what size the photo happens to render at.
 */
export const photoAnnotations = pgTable("photo_annotations", {
  id: text("id").primaryKey(),
  photoId: text("photo_id")
    .notNull()
    .references(() => photos.id, { onDelete: "cascade" }),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  xPct: doublePrecision("x_pct").notNull(),
  yPct: doublePrecision("y_pct").notNull(),
  note: text("note").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(isoNow),
});

/**
 * A client's heart reaction on a photo. One row per (photo, client) —
 * since login is shared per-company rather than per-person, this is a
 * company-wide like, not a per-person one. Toggling removes the row
 * rather than ever inserting a second one, enforced at the DB level so
 * a race can't produce a duplicate.
 */
export const photoReactions = pgTable(
  "photo_reactions",
  {
    id: text("id").primaryKey(),
    photoId: text("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(isoNow),
  },
  (table) => [uniqueIndex("photo_reactions_photo_client_unique").on(table.photoId, table.clientId)]
);

export const photoAnnotationsRelations = relations(photoAnnotations, ({ one }) => ({
  photo: one(photos, { fields: [photoAnnotations.photoId], references: [photos.id] }),
  client: one(clients, {
    fields: [photoAnnotations.clientId],
    references: [clients.id],
  }),
}));

export const photoReactionsRelations = relations(photoReactions, ({ one }) => ({
  photo: one(photos, { fields: [photoReactions.photoId], references: [photos.id] }),
  client: one(clients, {
    fields: [photoReactions.clientId],
    references: [clients.id],
  }),
}));

/**
 * A timestamped revision note on a draft video (`photos.kind =
 * 'video'`) — Video Review's equivalent of Photo Detail's pinned
 * annotations, keyed by playback time instead of an x/y point.
 */
export const videoNotes = pgTable("video_notes", {
  id: text("id").primaryKey(),
  photoId: text("photo_id")
    .notNull()
    .references(() => photos.id, { onDelete: "cascade" }),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  timestampSeconds: doublePrecision("timestamp_seconds").notNull(),
  note: text("note").notNull(),
  // Set by staff from the admin video-notes view once they've acted on
  // this note — lets that view show only what's still outstanding
  // across events, instead of every note ever left. Never set by the
  // client; this is purely an internal triage flag.
  addressedAt: text("addressed_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(isoNow),
});

export const videoReviewStatusEnum = ["awaiting_notes", "revision_requested", "approved"] as const;
export type VideoReviewStatus = (typeof videoReviewStatusEnum)[number];

/**
 * The client's decision on one draft video — at most one row per
 * video, keyed directly by `photoId` (no separate id; a video has
 * exactly zero or one review, so the foreign key doubles as the
 * primary key, same as `selections` doubles as one-per-event but with
 * an owned id there instead — this table has no need for a second
 * identity). Starts `awaiting_notes` implicitly: a row is created
 * lazily on first read/write rather than at video-upload time, since
 * there's no upload pipeline to hook that into yet (see README.md).
 */
export const videoReviews = pgTable("video_reviews", {
  photoId: text("photo_id")
    .primaryKey()
    .references(() => photos.id, { onDelete: "cascade" }),
  status: text("status", { enum: videoReviewStatusEnum }).notNull().default("awaiting_notes"),
  decidedAt: text("decided_at"),
});

export const videoNotesRelations = relations(videoNotes, ({ one }) => ({
  photo: one(photos, { fields: [videoNotes.photoId], references: [photos.id] }),
  client: one(clients, { fields: [videoNotes.clientId], references: [clients.id] }),
}));

export const videoReviewsRelations = relations(videoReviews, ({ one }) => ({
  photo: one(photos, { fields: [videoReviews.photoId], references: [photos.id] }),
}));

export const clientsRelations = relations(clients, ({ many }) => ({
  events: many(events),
}));

export const customPresetsRelations = relations(customPresets, ({ one }) => ({
  event: one(events, { fields: [customPresets.eventId], references: [events.id] }),
}));

export const photosRelations = relations(photos, ({ one, many }) => ({
  event: one(events, { fields: [photos.eventId], references: [events.id] }),
  selectionItems: many(selectionItems),
  annotations: many(photoAnnotations),
  reactions: many(photoReactions),
  videoNotes: many(videoNotes),
  videoReview: one(videoReviews, { fields: [photos.id], references: [videoReviews.photoId] }),
}));

export const selectionsRelations = relations(selections, ({ one, many }) => ({
  event: one(events, { fields: [selections.eventId], references: [events.id] }),
  items: many(selectionItems),
}));

export const selectionItemsRelations = relations(selectionItems, ({ one }) => ({
  selection: one(selections, {
    fields: [selectionItems.selectionId],
    references: [selections.id],
  }),
  photo: one(photos, { fields: [selectionItems.photoId], references: [photos.id] }),
}));

export const feedbackScoreSegmentEnum = ["promoter", "passive", "detractor"] as const;
export type FeedbackScoreSegment = (typeof feedbackScoreSegmentEnum)[number];

/**
 * One NPS response per submission, tied directly to the event (this
 * app has no client login/account — the event slug is the access
 * credential, same as everywhere else) rather than a separate client
 * entity.
 */
export const feedback = pgTable("feedback", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  score: integer("score").notNull(), // 0-10
  segment: text("segment", { enum: feedbackScoreSegmentEnum }).notNull(),
  tags: text("tags").notNull(), // JSON string[] of picked tag labels
  // Optional open-text field — the tag chips don't always capture what
  // someone wants to say. For a promoter, this takes priority over the
  // tags-composed sentence in testimonialText (see composeTestimonial's
  // caller) rather than being a second, separately-read field.
  freeText: text("free_text"),
  testimonialText: text("testimonial_text"), // composed quote, promoters only
  testimonialConsent: boolean("testimonial_consent").notNull().default(false),
  createdAt: text("created_at").notNull().$defaultFn(isoNow),
});

export const referralStatusEnum = ["issued", "redeemed", "expired"] as const;
export type ReferralStatus = (typeof referralStatusEnum)[number];

export const referrals = pgTable("referrals", {
  id: text("id").primaryKey(),
  feedbackId: text("feedback_id")
    .notNull()
    .references(() => feedback.id, { onDelete: "cascade" }),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }), // the referring event/client
  referredName: text("referred_name").notNull(),
  referredContact: text("referred_contact"), // WhatsApp or email, whatever they gave
  voucherCode: text("voucher_code").notNull().unique(),
  creditAmountIdr: integer("credit_amount_idr").notNull().default(500000),
  status: text("status", { enum: referralStatusEnum }).notNull().default("issued"),
  createdAt: text("created_at").notNull().$defaultFn(isoNow),
});

export const eventsRelations = relations(events, ({ many, one }) => ({
  photos: many(photos),
  customPresets: many(customPresets),
  feedback: many(feedback),
  selection: one(selections, {
    fields: [events.id],
    references: [selections.eventId],
  }),
  client: one(clients, { fields: [events.clientId], references: [clients.id] }),
}));

export const feedbackRelations = relations(feedback, ({ one, many }) => ({
  event: one(events, { fields: [feedback.eventId], references: [events.id] }),
  referrals: many(referrals),
}));

export const referralsRelations = relations(referrals, ({ one }) => ({
  feedback: one(feedback, { fields: [referrals.feedbackId], references: [feedback.id] }),
  event: one(events, { fields: [referrals.eventId], references: [events.id] }),
}));

/**
 * A free-text note from FOTOFOTO staff, meant for the CEO to review —
 * the internal-facing counterpart to client NPS feedback above.
 * `fotofoto-ops` (the separate CRM app) has a real equivalent of this
 * already (a feedback_requests table + a CEO-only review page), so this
 * mirrors that shape rather than inventing a different mechanism;
 * there's no VS Code file-based log involved on either side. Staff auth
 * here is a single shared password (see src/lib/staffSession.ts), not
 * per-person accounts, so `authorLabel` is free text the submitter
 * types in rather than a real identity reference.
 */
export const adminFeedback = pgTable("admin_feedback", {
  id: text("id").primaryKey(),
  authorLabel: text("author_label").notNull(),
  text: text("text").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(isoNow),
});
