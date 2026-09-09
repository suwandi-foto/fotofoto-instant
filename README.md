# FOTOFOTO Instant Event Photo Delivery

Working v1 build of the instant event photo delivery product line —
capture on a tethered phone, auto-edit with a preset, upload straight
to a live gallery, guests/clients access via a QR code with no login.

Full process, tier rules, and design decisions are written up in the
FOTOFOTO Strategy project as `fotofoto-instant-delivery-brief.md`.
This README covers the build itself.

## What's real vs. stubbed right now

This is a genuinely working build — every flow below runs end to end
against a real (local) database, real image processing, and real
file storage — but two pieces are intentionally local-dev stand-ins
for infrastructure that costs money and needs real accounts:

| Piece | Right now | Production target (confirmed stack) |
|---|---|---|
| Database | Postgres, via Drizzle ORM — any standard Postgres works; Neon's free tier is the easy no-cost option | Same — this is already the production target, just point `DATABASE_URL` at a real instance |
| Photo storage | Google Drive, via the adapter in `src/lib/googleDrive.ts` (`STORAGE_BACKEND=drive`) | Cloudflare R2 (S3-compatible, zero egress fees) once volume outgrows a personal Drive account — swap `src/lib/storage.ts` for an S3 client, nothing else changes |
| Photographer app | A web page at `/shoot/[slug]` using a file picker | A Capacitor-wrapped installable app with real USB/tethered-camera import — see "Photographer app" below |
| Video transcoding/watermarking | Not built — no pipeline sets a video's `previewPath`, so Video Review's player always shows a static placeholder (see "Video Review" below) | A real transcode + low-res watermarked preview step, mirroring the existing photo preset/preview/watermark pipeline in `src/lib/image.ts` |

Everything else — the data model, the API, the image pipeline (preset
+ compressed preview + watermark), the gallery UI, the selection/quota/
finalize flow, the offline upload queue — is the real thing, not a
mock.

One note on the ORM: the brief didn't call out a specific ORM, but
Prisma (a common default choice) needs to download a compiled binary
from `binaries.prisma.sh` at setup time, which this build environment's
network allowlist blocks. Drizzle ORM was used instead — installs
entirely through npm, no external binary fetch, and works the same way
against Postgres later.

## Running it

Needs a Postgres database (`DATABASE_URL` in `.env.local` — Neon's
free tier works well) and, for Google Drive photo storage,
`STORAGE_BACKEND=drive` plus the `GOOGLE_DRIVE_*` vars from
`node scripts/drive-auth.mjs` (see "Photo storage" above). Set
`SESSION_SECRET` too before deploying anywhere real — it signs the
client-contact login cookie (see "Client-contact login" below) and
falls back to an insecure dev value only outside production.

```bash
npm install
npx drizzle-kit push   # creates the tables from src/db/schema.ts
npm run dev             # http://localhost:3000
```

Open `/` — that's a small control-room page for creating test events
(no real booking system exists yet, this stands in for it) and getting
links to each event's gallery, QR code, and photographer app.

## How the pieces fit together

- **`src/db/schema.ts`** — the data model: `events` (one QR/link, one
  tier, a quota), `photos` (original + preview renditions, preset,
  status), `selections` / `selectionItems` (one shared selection per
  select-tier event, per the confirmed "client link, not per-guest"
  decision).
- **`src/lib/image.ts`** — runs once per uploaded photo. Applies the
  chosen preset, produces the full-resolution original and a
  compressed (~1000px, WebP) preview, and — for select-tier events —
  composites the tiled watermark + "LOW-RES" badge onto the preview
  only, never the original.
- **`src/lib/storage.ts`** — the only place that knows where photo
  bytes physically live. Everything else asks for a photo by key.
- **`src/app/api/events/[slug]/photos/route.ts`** — `POST` is what the
  photographer's app calls after its on-device preset edit; `GET` is
  the gallery's polling endpoint, and deliberately returns only
  preview URLs, never original paths.
- **`src/app/api/photos/[id]/download/route.ts`** — the only route
  that ever serves full-resolution bytes. For select-tier events this
  checks the photo is both selected *and* the selection is finalized
  before allowing it — the actual enforcement of "full-res unlocks on
  finalize."
- **`src/app/e/[slug]`** — the guest/client gallery. Branches on the
  event's tier: full-access renders a plain masonry grid with
  per-photo and download-all buttons; select-tier renders the
  watermarked tap-to-select grid with the quota counter and Finalize
  action. Polls every 4s rather than using websockets, per the
  confirmed "simple polling is enough at event pace" decision.
- **`src/app/shoot/[slug]`** — the photographer's tool. Preset picker,
  a file-based stand-in for tethered capture, and a real IndexedDB-
  backed offline queue (`src/lib/offlineQueue.ts`) that retries
  automatically on reconnect — this part is built to the same
  correctness bar it'll need in the packaged app, not simplified.

## Client-contact login

Separate from the guest gallery's QR/link access (which stays
credential-free by design), a minimal real login exists for the
upcoming Photo Detail and Video Review screens — both need to show
*who* left a pin annotation or revision note ("Sarah (Marketing)",
"You"), which the QR/link model can't answer on its own.

- `clients` / `clientContacts` / `authTokens` in `src/db/schema.ts`.
  `clients` is intentionally minimal and separate from the CRM's
  Client entity in the `fotofoto-ops` codebase — `opsClientId` is a
  loose, nullable cross-reference, not a mirror of that data.
- Passwordless magic-link flow: `POST /api/auth/request-link` issues a
  30-minute single-use token for a seeded contact's email;
  `GET /api/auth/consume?token=...` redeems it, sets a signed
  `ff_contact_session` cookie (HMAC-SHA256 via `src/lib/session.ts`,
  no extra dependency), and redirects to `/library`. Real email
  delivery doesn't exist yet — `request-link` returns the raw link
  inline instead (see the dev-only comment on that route).
- There's no staff-facing "add a contact" UI yet — seed one via
  `POST /api/dev/contacts` (blocked outside `NODE_ENV !== "production"`),
  e.g.:
  ```bash
  curl -X POST http://localhost:3000/api/dev/contacts \
    -H "Content-Type: application/json" \
    -d '{"companyName":"PT Example","name":"Sarah","department":"Marketing","email":"sarah@example.com"}'
  ```
- `getCurrentContact()` and the `formatAuthorName()` "You" helper
  (both in `src/lib/session.ts`) are what Photo Detail/Video Review
  are expected to build on.

## Photo Detail (pin annotations, reactions, share)

`/e/[slug]/photo/[id]` — reached from the gallery lightbox's "Notes &
reactions" link — is a logged-in-only page (unlike the rest of the
guest gallery) since it needs a real identity to attribute pins and
notes to.

- `photo_annotations` / `photo_reactions` in `src/db/schema.ts`. A pin
  is stored as `xPct`/`yPct` (0-100, relative to the image, not
  pixels) so it stays correctly placed at any render size.
  `photo_reactions` has a DB-level unique index on
  `(photo_id, contact_id)` — one heart per contact per photo, toggled
  rather than duplicated.
- `GET`/`POST /api/photos/[id]/annotations` and
  `POST /api/photos/[id]/reactions/toggle` all require a logged-in
  contact (401 otherwise); annotation authors are resolved through the
  same "You" helper from client-contact login.
- "Share to Instagram Story" uses the Web Share API
  (`navigator.share` with the photo file) where supported, falling
  back to downloading the photo for a manual share — there's no real
  Instagram Stories API a web app can call.
- No editing/deleting annotations yet, and no notifications when
  someone else adds one — capture + display only for this pass.

## Video Review (timestamped notes, approve/revise)

`/e/[slug]/video/[id]` — same logged-in-only pattern as Photo Detail,
for a `photos` row with `kind = 'video'`.

**Known limitation, by design for this pass**: this app has no real
video transcoding/watermarking pipeline yet (the delivery brief flags
video as the biggest remaining engineering lift) — nothing ever sets
`previewPath` on a video row, so the player always falls back to a
static placeholder instead of actually playing something. Everything
*around* the player is fully real and already exercised end-to-end:
the data model, both API routes, note timestamps/positions on the
scrub bar, and the approve/revise decision (persisted, one-shot, no
staff-override actor exists in this app's auth model so a decision is
final once made). `GET /api/videos/[id]/preview` is built against the
real intended shape (serves `previewPath` with a matching video
content-type) so nothing here needs to change once that pipeline
exists — it will just start actually working.

- `photos.kind` (`'photo' | 'video'`, defaults to `'photo'`) added to
  distinguish the two; `video_notes` / `video_reviews` in
  `src/db/schema.ts`. `video_reviews` is keyed directly by `photoId`
  (no separate id — a video has at most one review) and is created
  lazily on first read, since there's no upload step to hook that
  into yet.
- `GET`/`POST /api/videos/[id]/notes` and
  `POST /api/videos/[id]/decision` require a logged-in contact, same
  as Photo Detail's routes.

## Photographer app

A plain website can't get file-system/USB access to import photos
from a camera tethered to the phone — that needs an installable app
with real device permissions. The confirmed direction is a
Capacitor-wrapped app: reuse this same web code and UI, package it as
an installable iOS/Android app via Capacitor, and add native plugins
for USB/file import and background upload. The `/shoot/[slug]` page
here is what that app's web layer would look like; the offline queue
and upload logic (`src/lib/offlineQueue.ts`) is written to carry over
largely as-is.

## Known gaps / next decisions

- The guest gallery itself still has no auth (confirmed, staying that
  way — the link/QR is the credential). Worth a lightweight safeguard
  later (expiring links, less guessable IDs) if this goes beyond v1.
  Separately, a minimal client-contact login now exists for Photo
  Detail/Video Review — see "Client-contact login" above; it has no
  self-signup, password reset, or FOTOFOTO-staff contact-management UI
  yet.
- "Download All" zips originals on the fly, streamed as it builds.
  Fine at event scale; a queue-based background zip job would be the
  next step for very large events.
- The preset "edit" is a simple, deterministic Sharp color pipeline
  (modulate/tint/contrast per preset), not graded LUTs — good enough
  to prove the pipeline, worth revisiting for real visual quality.
- No payment integration (confirmed as manual/offline for v1) — extra
  photos beyond quota are just flagged with a count in the UI.
