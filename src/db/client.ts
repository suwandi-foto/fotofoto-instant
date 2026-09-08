/**
 * Postgres database client, via Neon's HTTP driver rather than a raw
 * TCP connection pool. Every query goes out as a single HTTPS
 * request — no persistent connection to leak or exhaust across many
 * short-lived serverless function instances, which is exactly the
 * shape a Vercel deployment runs in. It also happens to work from
 * networks that block outbound Postgres's usual port (5432) but
 * allow normal HTTPS, which raw `pg`/node-postgres does not.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see README for how to point this at a Postgres database.");
}

const sql = neon(connectionString);

export const db = drizzle(sql, { schema });
