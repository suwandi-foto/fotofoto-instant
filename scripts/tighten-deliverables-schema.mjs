#!/usr/bin/env node
/**
 * ONE-TIME PRODUCTION MIGRATION — step 3 of 3 (see README.md's
 * "Deploying the deliverables feature" section).
 *
 * Run this ONLY after scripts/backfill-deliverables.mjs has reported
 * a clean 0/0 gap (every photo and selection already has a
 * deliverable_id). Locks in the final schema: makes
 * photos.deliverable_id required, makes selections.deliverable_id
 * required (it's already unique, added that way in step 1), and
 * drops the now-unused selections.event_id column entirely.
 *
 * Same manual-DDL-over-HTTP approach as
 * scripts/push-deliverables-schema.mjs, for the same reason
 * (drizzle-kit push fails silently against this database from this
 * network). Re-running this after it has already succeeded is
 * harmless — every statement is a no-op the second time.
 *
 * Usage:
 *   NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first" \
 *     DATABASE_URL=postgresql://... node scripts/tighten-deliverables-schema.mjs
 */
import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const sql = neon(connectionString);
const q = (text, params = []) => sql.query(text, params, { fullResults: true });

async function main() {
  console.log("Verifying every row already has a deliverable_id...");
  const { rows: photoGap } = await q(`SELECT count(*)::int AS n FROM photos WHERE deliverable_id IS NULL`);
  const { rows: selectionGap } = await q(`SELECT count(*)::int AS n FROM selections WHERE deliverable_id IS NULL`);
  if (photoGap[0].n !== 0 || selectionGap[0].n !== 0) {
    console.error(
      `NOT SAFE: ${photoGap[0].n} photo(s) and ${selectionGap[0].n} selection(s) still lack a deliverable_id. ` +
        `Run scripts/backfill-deliverables.mjs again first.`
    );
    process.exit(1);
  }
  console.log("  confirmed clean.");

  console.log("1/3 Setting photos.deliverable_id NOT NULL...");
  await q(`ALTER TABLE photos ALTER COLUMN deliverable_id SET NOT NULL`);
  console.log("    done.");

  console.log("2/3 Setting selections.deliverable_id NOT NULL...");
  await q(`ALTER TABLE selections ALTER COLUMN deliverable_id SET NOT NULL`);
  console.log("    done.");

  console.log("3/3 Dropping selections.event_id (if present)...");
  await q(`ALTER TABLE selections DROP COLUMN IF EXISTS event_id`);
  console.log("    done.");

  console.log("\nDone. Schema now matches src/db/schema.ts exactly.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err);
    process.exit(1);
  });
