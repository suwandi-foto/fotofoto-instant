#!/usr/bin/env node
/**
 * ONE-TIME PRODUCTION MIGRATION — step 1 of 3 (see README.md's
 * "Deploying the deliverables feature" section and the
 * "MIGRATION IN PROGRESS" comments in src/db/schema.ts).
 *
 * Applies the same additive schema change `npx drizzle-kit push`
 * would, by hand — written because `drizzle-kit push` failed silently
 * on this machine (no error, just hangs at "Pulling schema from
 * database..." and exits non-zero) even with a confirmed-working
 * DATABASE_URL and confirmed network access to Neon. Uses
 * @neondatabase/serverless's HTTP driver (the same one src/db/client.ts
 * uses at runtime, over port 443) rather than drizzle-kit's raw
 * Postgres-protocol 'pg' driver (port 5432), sidestepping whatever
 * that tool was tripping over.
 *
 * Every statement is idempotent (checked-then-applied, or IF NOT
 * EXISTS/IF EXISTS) so this is safe to re-run.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/push-deliverables-schema.mjs
 */
import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const sql = neon(connectionString);

async function columnExists(table, column) {
  const { rows } = await sql.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

async function main() {
  console.log("1/5 Creating event_deliverables table (if not present)...");
  await sql.query(`
    CREATE TABLE IF NOT EXISTS event_deliverables (
      id text PRIMARY KEY,
      event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name text NOT NULL,
      tier text NOT NULL,
      quota integer NOT NULL DEFAULT 0,
      extra_unit_note text DEFAULT 'Extra photos are invoiced separately by our team after the event.',
      status text NOT NULL DEFAULT 'in_progress',
      created_at text NOT NULL
    )
  `);

  console.log("2/5 Adding photos.deliverable_id (if not present)...");
  if (!(await columnExists("photos", "deliverable_id"))) {
    await sql.query(
      `ALTER TABLE photos ADD COLUMN deliverable_id text REFERENCES event_deliverables(id) ON DELETE CASCADE`
    );
    console.log("    added.");
  } else {
    console.log("    already present, skipped.");
  }

  console.log("3/5 Adding selections.deliverable_id (if not present)...");
  if (!(await columnExists("selections", "deliverable_id"))) {
    await sql.query(
      `ALTER TABLE selections ADD COLUMN deliverable_id text UNIQUE REFERENCES event_deliverables(id) ON DELETE CASCADE`
    );
    console.log("    added.");
  } else {
    console.log("    already present, skipped.");
  }

  console.log("4/5 Relaxing selections.event_id to nullable...");
  await sql.query(`ALTER TABLE selections ALTER COLUMN event_id DROP NOT NULL`);
  console.log("    done (harmless if it already was nullable).");

  console.log("5/5 Dropping selections.event_id's old unique constraint (if present)...");
  const { rows: constraints } = await sql.query(`
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_name = kcu.table_name
    WHERE tc.table_name = 'selections' AND tc.constraint_type = 'UNIQUE' AND kcu.column_name = 'event_id'
  `);
  if (constraints.length === 0) {
    console.log("    none found, skipped.");
  } else {
    for (const { constraint_name } of constraints) {
      await sql.query(`ALTER TABLE selections DROP CONSTRAINT "${constraint_name}"`);
      console.log(`    dropped ${constraint_name}.`);
    }
  }

  console.log("\nDone. Schema is now ready for scripts/backfill-deliverables.mjs.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err);
    process.exit(1);
  });
