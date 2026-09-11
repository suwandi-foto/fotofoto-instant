import { NextResponse } from "next/server";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events, photos } from "@/db/schema";
import {
  createClient,
  createEvent,
  createQueuedPhoto,
  markPhotoLive,
  createPhotoAnnotation,
  togglePhotoReaction,
  toggleSelectionItem,
  createVideoNote,
  decideVideoReview,
  createFeedback,
  createReferral,
} from "@/lib/queries";
import { putObject, originalKey, previewKey } from "@/lib/storage";
import { processCapturedPhoto } from "@/lib/image";
import { generateId } from "@/lib/ids";

/**
 * DEV-ONLY: populates a realistic demo dataset (one client, two events
 * with live photos/a video, annotations, reactions, feedback +
 * referral) in one call, so the app can be clicked through locally
 * without a real event ever having happened. Placeholder photos are
 * generated in-process (solid-color SVG -> sharp) and run through the
 * real processCapturedPhoto pipeline, so previews/originals behave
 * exactly like a real upload's. Blocked outside dev for the same
 * reason as /api/dev/clients.
 *
 * Not idempotent — the access code is fixed, so a second call fails on
 * the clients.access_code unique constraint. Reset by deleting the
 * seeded client row (cascades to events/photos/etc.) before re-running.
 */
const SEED_ACCESS_CODE = "DEMO123";
const PALETTE = [
  { r: 214, g: 138, b: 60 }, // gold
  { r: 79, g: 109, b: 122 },
  { r: 156, g: 82, b: 96 },
  { r: 96, g: 122, b: 88 },
  { r: 138, g: 105, b: 158 },
  { r: 176, g: 148, b: 92 },
  { r: 71, g: 94, b: 138 },
  { r: 168, g: 92, b: 74 },
  { r: 92, g: 138, b: 128 },
  { r: 122, g: 96, b: 148 },
];

const ORIENTATIONS: { w: number; h: number }[] = [
  { w: 1200, h: 800 }, // landscape
  { w: 800, h: 1200 }, // portrait
  { w: 1000, h: 1000 }, // square
];

async function placeholderRaw(label: string, w: number, h: number, color: { r: number; g: number; b: number }) {
  const fontSize = Math.round(Math.min(w, h) / 9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="rgb(${color.r},${color.g},${color.b})"/>
        <stop offset="1" stop-color="rgb(${Math.max(0, color.r - 40)},${Math.max(0, color.g - 40)},${Math.max(0, color.b - 40)})"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="50%" y="50%" font-family="sans-serif" font-size="${fontSize}" font-weight="700"
      fill="rgba(255,255,255,0.88)" text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

async function seedLivePhoto(eventId: string, index: number, label: string) {
  const size = ORIENTATIONS[index % ORIENTATIONS.length];
  const color = PALETTE[index % PALETTE.length];
  const raw = await placeholderRaw(label, size.w, size.h, color);
  const processed = await processCapturedPhoto(raw, { kind: "builtin", id: "original" }, false);

  const photoId = await createQueuedPhoto(eventId, "original");
  const oKey = originalKey(eventId, photoId);
  const pKey = previewKey(eventId, photoId);
  await putObject(oKey, processed.original);
  await putObject(pKey, processed.preview);
  await markPhotoLive(photoId, {
    originalPath: oKey,
    previewPath: pKey,
    width: processed.width,
    height: processed.height,
    orientation: processed.orientation,
  });
  return photoId;
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const origin = new URL(req.url).origin;

  const client = await createClient({
    companyName: "PT Nusantara Digital",
    accessCode: SEED_ACCESS_CODE,
    opsClientId: "demo-crm-001",
  });

  // Event A — full access, already "delivered": live photos, a video
  // under review, annotations/reactions, and a submitted NPS response.
  const eventA = await createEvent({
    name: "Nusantara Annual Gala 2026",
    clientName: client!.companyName,
    tier: "full_access",
  });
  await db.update(events).set({ clientId: client!.id }).where(eq(events.id, eventA!.id));

  const eventAPhotoIds: string[] = [];
  for (let i = 0; i < 9; i++) {
    eventAPhotoIds.push(await seedLivePhoto(eventA!.id, i, `Gala ${i + 1}`));
  }

  await createPhotoAnnotation({
    photoId: eventAPhotoIds[0],
    clientId: client!.id,
    xPct: 32,
    yPct: 58,
    note: "Love this candid moment — can we get it on the highlight reel?",
  });
  await createPhotoAnnotation({
    photoId: eventAPhotoIds[0],
    clientId: client!.id,
    xPct: 70,
    yPct: 22,
    note: "Can we get this cropped a bit tighter on the left?",
  });
  await togglePhotoReaction(eventAPhotoIds[1], client!.id);
  await togglePhotoReaction(eventAPhotoIds[2], client!.id);

  // A draft video, still awaiting the real transcoding pipeline (see
  // README) — no preview bytes, same as production would have it.
  const videoId = generateId();
  await db.insert(photos).values({
    id: videoId,
    eventId: eventA!.id,
    kind: "video",
    preset: "original",
    status: "live",
    uploadedAt: new Date().toISOString(),
  });
  await createVideoNote({
    photoId: videoId,
    clientId: client!.id,
    timestampSeconds: 4.2,
    note: "Love the drone shot here!",
  });
  await createVideoNote({
    photoId: videoId,
    clientId: client!.id,
    timestampSeconds: 18.5,
    note: "Can we trim the intro by a couple seconds?",
  });
  await decideVideoReview(videoId, "revise");

  const feedbackRow = await createFeedback({
    eventId: eventA!.id,
    score: 10,
    segment: "promoter",
    tags: ["Great communication", "Fast delivery"],
    testimonialText:
      "FOTOFOTO absolutely nailed our gala — professional, fast, and the photos are stunning.",
    testimonialConsent: true,
  });
  await createReferral({
    feedbackId: feedbackRow!.id,
    eventId: eventA!.id,
    referredName: "Dewi Lestari",
    referredContact: "dewi@example.com",
  });

  // Event B — select tier, mid-selection (not finalized), so the
  // quota/finalize flow has something real to click through.
  const eventB = await createEvent({
    name: "Product Launch Shoot",
    clientName: client!.companyName,
    tier: "select",
    quota: 15,
  });
  await db.update(events).set({ clientId: client!.id }).where(eq(events.id, eventB!.id));

  const eventBPhotoIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    eventBPhotoIds.push(await seedLivePhoto(eventB!.id, i, `Launch ${i + 1}`));
  }
  for (const photoId of eventBPhotoIds.slice(0, 4)) {
    await toggleSelectionItem(eventB!.id, photoId);
  }

  return NextResponse.json({
    ok: true,
    client: {
      id: client!.id,
      companyName: client!.companyName,
      opsClientId: client!.opsClientId,
      accessCode: client!.accessCode,
    },
    events: [
      { name: eventA!.name, slug: eventA!.slug, tier: eventA!.tier, galleryUrl: `${origin}/e/${eventA!.slug}`, videoReviewUrl: `${origin}/e/${eventA!.slug}/video/${videoId}` },
      { name: eventB!.name, slug: eventB!.slug, tier: eventB!.tier, galleryUrl: `${origin}/e/${eventB!.slug}` },
    ],
  });
}
