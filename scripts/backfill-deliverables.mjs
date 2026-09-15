#!/usr/bin/env node
/**
 * ONE-TIME PRODUCTION MIGRATION — step 2 of 3 in rolling out
 * deliverables (see the "MIGRATION IN PROGRESS" comments on
 * `selections` and `photos.deliverableId` in src/db/schema.ts).
 *
 * Run this:
 *   1. AFTER `npx drizzle-kit push` has additively pushed the new
 *      event_deliverables table and the nullable
 *      photos.deliverable_id / selections.deliverable_id columns.
 *   2. BEFORE deploying any app code that assumes every photo/
 *      selection already has a deliverable_id (i.e. before this
 *      feature's Phase 1+ code goes live) — that code will 404/error
 *      on any photo whose deliverable_id is still null.
 *
 * For every event that doesn't have a deliverable yet, creates one
 * named "All Photos" inheriting that event's current
 * tier/quota/extra_unit_note, then reassigns that event's photos (and
 * its selections row, if select-tier) to it.
 *
 * Idempotent and resumable on purpose: every write is scoped to rows
 * that still need it (`deliverable_id IS NULL`), not gated on "does
 * this event have a deliverable yet" as a single all-or-nothing check
 * — so re-running after an interruption (network blip, Ctrl+C)
 * finishes exactly what's left rather than risking a half-migrated
 * event, and running it twice in a row is harmless.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/backfill-deliverables.mjs
 *
 * At the end it reports whether every photo/selection now has a
 * deliverable_id — only once that's true is it safe to run the
 * step-3 tightening schema push (drop selections.event_id, make
 * deliverable_id notNull/unique).
 */
import { neon } from "@neondatabase/serverless";
import { customAlphabet } from "nanoid";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

// Same alphabet/length as src/lib/ids.ts's generateId, so these rows
// are indistinguishable from ones the app itself would create.
const generateId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);

const sql = neon(connectionString);
// Neon's HTTP driver returns a plain array of rows by default; pass
// fullResults so query() gives back {rows, rowCount, ...} like
// node-postgres, which is what rowCount below relies on.
const q = (text, params = []) => sql.query(text, params, { fullResults: true });

async function main() {
  const { rows: pendingEvents } = await q(`
    SELECT e.id, e.tier, e.quota, e.extra_unit_note
    FROM events e
    WHERE NOT EXISTS (SELECT 1 FROM event_deliverables d WHERE d.event_id = e.id)
    ORDER BY e.created_at ASC
  `);

  console.log(`${pendingEvents.length} event(s) with no deliverable yet.`);

  let eventsProcessed = 0;
  let photosReassigned = 0;
  let selectionsReassigned = 0;

  for (const event of pendingEvents) {
    const deliverableId = generateId();
    await q(
      `INSERT INTO event_deliverables (id, event_id, name, tier, quota, extra_unit_note, status, created_at)
       VALUES ($1, $2, 'All Photos', $3, $4, $5, 'in_progress', now()::text)`,
      [deliverableId, event.id, event.tier, event.quota, event.extra_unit_note]
    );

    const photosRes = await q(
      `UPDATE photos SET deliverable_id = $1 WHERE event_id = $2 AND deliverable_id IS NULL`,
      [deliverableId, event.id]
    );
    photosReassigned += photosRes.rowCount ?? 0;

    if (event.tier === "select") {
      const selRes = await q(
        `UPDATE selections SET deliverable_id = $1 WHERE event_id = $2 AND deliverable_id IS NULL`,
        [deliverableId, event.id]
      );
      selectionsReassigned += selRes.rowCount ?? 0;
    }

    eventsProcessed++;
    console.log(`  event ${event.id} -> deliverable ${deliverableId}`);
  }

  console.log(
    `Done this run. Events processed: ${eventsProcessed}, photos reassigned: ${photosReassigned}, selections reassigned: ${selectionsReassigned}`
  );

  const { rows: photoGap } = await q(`SELECT count(*)::int AS n FROM photos WHERE deliverable_id IS NULL`);
  const { rows: selectionGap } = await q(
    `SELECT count(*)::int AS n FROM selections WHERE deliverable_id IS NULL`
  );
  const photosLeft = photoGap[0].n;
  const selectionsLeft = selectionGap[0].n;
  console.log(`Photos still without a deliverable: ${photosLeft}`);
  console.log(`Selections still without a deliverable: ${selectionsLeft}`);

  if (photosLeft === 0 && selectionsLeft === 0) {
    console.log("All clear — safe to run the step-3 tightening schema push next.");
  } else {
    console.log("NOT fully migrated — do not run the tightening push yet. Investigate the remaining rows above.");
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
