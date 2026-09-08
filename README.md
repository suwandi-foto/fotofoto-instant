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
`node scripts/drive-auth.mjs` (see "Photo storage" above).

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

- No auth anywhere (confirmed — the link/QR is the credential). Worth
  a lightweight safeguard later (expiring links, less guessable IDs)
  if this goes beyond v1.
- "Download All" zips originals on the fly, streamed as it builds.
  Fine at event scale; a queue-based background zip job would be the
  next step for very large events.
- The preset "edit" is a simple, deterministic Sharp color pipeline
  (modulate/tint/contrast per preset), not graded LUTs — good enough
  to prove the pipeline, worth revisiting for real visual quality.
- No payment integration (confirmed as manual/offline for v1) — extra
  photos beyond quota are just flagged with a count in the UI.
