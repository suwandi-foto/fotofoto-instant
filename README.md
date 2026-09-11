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
client login cookie (see "Client login" below) and falls back to an
insecure dev value only outside production. Set `FOTOFOTO_SSO_SECRET`
as well if you want the Communication Health card's fotofoto-ops
handoff to work (see "Single sign-on to fotofoto-ops" below), and
`FOTOFOTO_OPS_INBOUND_SECRET` if you want fotofoto-ops to be able to
provision clients here (see "Client login" below) — unlike
`SESSION_SECRET`, neither of those has a dev fallback, since both must
match a value set in fotofoto-ops's own environment.

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

## Client login

Separate from the guest gallery's QR/link access (which stays
credential-free by design), a minimal real login exists for Photo
Detail and Video Review. Login is per-*client company*, not per named
person — one shared access code, no personal identity tracked or
shown anywhere (pin annotations, video notes, and reactions are all
scoped to which client is logged in, not which person on their team).

- `clients` in `src/db/schema.ts` carries the login directly:
  `accessCode` (staff-chosen, not generated by this app), plus
  `opsClientId` — a *unique*, actively-used cross-reference to the
  separate `fotofoto-ops` CRM app, not a mirror of its data.
- Access-code login, one field/one step: `POST /api/auth/login` looks
  the code up (case-sensitive, trim-only — see `getClientByAccessCode`
  in `src/lib/queries.ts`), sets a signed `ff_client_session` cookie
  (HMAC-SHA256 via `src/lib/session.ts`, no extra dependency), and the
  client lands on `/library`. The code isn't single-use or
  time-limited — it's a real credential, valid until staff rotates it.
- Two ways a client gets provisioned:
  - **Primary path**: fotofoto-ops calls `POST /api/ops/clients`
    (bearer-secret-authenticated with `FOTOFOTO_OPS_INBOUND_SECRET`,
    separate from `FOTOFOTO_SSO_SECRET` below) when staff marks a lead
    as a client there and types a password — see
    `upsertClientFromOps` in `src/lib/queries.ts`. Idempotent on
    `opsClientId`: a repeat call updates the existing client's
    `companyName`/`accessCode` rather than creating a duplicate.
  - **Manual fallback**: the staff-gated `/admin/clients` page (same
    `STAFF_PASSWORD` auth as `/admin/feedback`), backed by
    `POST /api/admin/clients` — for clients with no fotofoto-ops
    record yet, or rotating a code this app has no way to request from
    that side. `POST /api/dev/clients` is the `curl`-able dev
    equivalent (blocked outside `NODE_ENV !== "production"`), e.g.:
    ```bash
    curl -X POST http://localhost:3000/api/dev/clients \
      -H "Content-Type: application/json" \
      -d '{"companyName":"PT Example","accessCode":"DEMO123"}'
    ```
- `getCurrentClient()` in `src/lib/session.ts` is every protected
  route/page's entry point for "who's logged in" — it returns just a
  `clientId`, nothing else.

## Single sign-on to fotofoto-ops

The Communication Health card (see `CommunicationHealthCard` in
`src/app/library/EntryCards.tsx`) links a logged-in client through to
their ACTR score/roadmap on the separate `fotofoto-ops` app
(`fotofoto-ops.vercel.app`) *already authenticated* — no second
credential prompt on that side.

- Only outbound (instant → ops) is built here; the reverse direction
  is a separate build in the `fotofoto-ops` repo.
- The card's href is `GET /api/sso/ops`, not a bare link — that route
  mints a short-lived signed handoff token at click time (see
  `src/lib/opsSso.ts`) and 302s to
  `https://fotofoto-ops.vercel.app/portal/sso?token=...`. Minting it at
  click time, rather than baking one into `/library`'s rendered HTML,
  matters because the token expires in 60 seconds — long enough to
  cover the redirect, but it could easily lapse between a page load
  and an actual click.
- The token is `base64url(JSON payload) + "." + base64url(HMAC-SHA256
  signature)`, signed with `FOTOFOTO_SSO_SECRET` — the same value must
  be set in both this app's environment (Hostinger) and fotofoto-ops's
  (Vercel), or the ops side can't verify what this app signed. There's
  no dev fallback for this one (see "Running it" above).
- 60 seconds is the only replay protection — there's no nonce store
  tracking already-used tokens. Accepted tradeoff for this pass, not
  an oversight.
- The payload's `contactName` field carries the client's `companyName`
  now, not a person's name (this app dropped per-contact identity —
  see "Client login" above) — the wire field name is kept as-is for
  this pass specifically to avoid forcing a simultaneous fotofoto-ops
  deploy, so that repo's SSO verifier should be checked/updated to
  expect a company name there.
- The handoff only fires when the client has both an entitling
  `relationshipStage` (`growth_partner`/`enterprise`) *and* a non-null
  `opsClientId`. `opsClientId` is now populated via the primary
  provisioning path (`POST /api/ops/clients`, see "Client login"
  above) — a client created through the manual `/admin/clients`
  fallback instead still has `opsClientId = null` until connected some
  other way, and the card renders as the disabled "Not yet connected"
  state for those.

## Photo Detail (pin annotations, reactions, share)

`/e/[slug]/photo/[id]` — reached from the gallery lightbox's "Notes &
reactions" link — is a logged-in-only page (unlike the rest of the
guest gallery), scoped to which client is logged in.

- `photo_annotations` / `photo_reactions` in `src/db/schema.ts`. A pin
  is stored as `xPct`/`yPct` (0-100, relative to the image, not
  pixels) so it stays correctly placed at any render size.
  `photo_reactions` has a DB-level unique index on
  `(photo_id, client_id)` — one heart per client company per photo,
  toggled rather than duplicated. No per-person attribution is stored
  or shown anywhere (see "Client login" above).
- `GET`/`POST /api/photos/[id]/annotations` and
  `POST /api/photos/[id]/reactions/toggle` all require a logged-in
  client (401 otherwise).
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
  `POST /api/videos/[id]/decision` require a logged-in client, same
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
  Separately, a minimal client login now exists for Photo Detail/Video
  Review — see "Client login" above; it has no self-signup or
  password-reset flow yet, and code rotation is a manual staff action.
- "Download All" zips originals on the fly, streamed as it builds.
  Fine at event scale; a queue-based background zip job would be the
  next step for very large events.
- The preset "edit" is a simple, deterministic Sharp color pipeline
  (modulate/tint/contrast per preset), not graded LUTs — good enough
  to prove the pipeline, worth revisiting for real visual quality.
- No payment integration (confirmed as manual/offline for v1) — extra
  photos beyond quota are just flagged with a count in the UI.
