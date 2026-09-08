/**
 * FOTOFOTO Instant Event Photo Delivery — data model.
 *
 * Postgres (see src/db/client.ts), per the confirmed production
 * stack. Timestamp columns are plain `text` holding ISO strings
 * (via $defaultFn) rather than native `timestamp` columns — keeps the
 * JS-side type a plain string everywhere the app already expects one,
 * with no dialect-specific default-expression casting to worry about.
 */
import { pgTable, text, integer, boolean } from "drizzle-orm/pg-core";
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

/**
 * A single captured, processed photo belonging to one event.
 * - previewPath: compressed rendition (~1000px, WebP), what every
 *   gallery view loads. For select-tier events this is additionally
 *   watermarked at generation time.
 * - originalPath: untouched full-resolution file. Only ever served by
 *   the download endpoints, never embedded directly in a gallery page.
 */
export const photos = pgTable("photos", {
  id: text("id").primaryKey(), // nanoid
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  preset: text("preset").notNull(), // a Preset id, or "custom:<customPresets.id>"
  status: text("status", { enum: photoStatusEnum }).notNull().default("queued"),
  originalPath: text("original_path"), // set once the original is stored
  previewPath: text("preview_path"), // set once the preview is generated
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

export const customPresetsRelations = relations(customPresets, ({ one }) => ({
  event: one(events, { fields: [customPresets.eventId], references: [events.id] }),
}));

export const photosRelations = relations(photos, ({ one, many }) => ({
  event: one(events, { fields: [photos.eventId], references: [events.id] }),
  selectionItems: many(selectionItems),
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
}));

export const feedbackRelations = relations(feedback, ({ one, many }) => ({
  event: one(events, { fields: [feedback.eventId], references: [events.id] }),
  referrals: many(referrals),
}));

export const referralsRelations = relations(referrals, ({ one }) => ({
  feedback: one(feedback, { fields: [referrals.feedbackId], references: [feedback.id] }),
  event: one(events, { fields: [referrals.eventId], references: [events.id] }),
}));
