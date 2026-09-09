/**
 * Internal staff session — gates the new admin surfaces (CEO feedback
 * log, cross-event video-notes triage) added in this pass. Deliberately
 * a single shared password (STAFF_PASSWORD env var), not per-person
 * accounts: there's no staff table anywhere in this codebase yet, and
 * building real per-staff auth is a bigger, separate decision. Same
 * signed-cookie approach as session.ts (HMAC-SHA256, no JWT library),
 * reusing SESSION_SECRET rather than introducing a second secret.
 *
 * This is intentionally *not* applied to /control/[slug] (the existing
 * Control Room) — that surface already ships to photographers via a
 * slug link with no login, and retrofitting auth onto an in-use surface
 * is a separate, riskier change from adding new admin-only pages.
 */
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

const STAFF_COOKIE_NAME = "ff_staff_session";
const STAFF_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET is not set — required in production to sign session cookies.");
    }
    return "dev-only-insecure-session-secret";
  }
  return secret;
}

function getStaffPassword(): string {
  const password = process.env.STAFF_PASSWORD;
  if (!password) {
    throw new Error("STAFF_PASSWORD is not set — required to sign in to the admin surfaces.");
  }
  return password;
}

function sign(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

type StaffPayload = { staff: true; exp: number };

function encode(payload: StaffPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decode(raw: string): StaffPayload | null {
  const [body, signature] = raw.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StaffPayload;
    if (payload.staff !== true) return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Constant-time compare against STAFF_PASSWORD — timingSafeEqual
 * throws on mismatched lengths, so that's checked first (itself not a
 * useful timing signal, since password length isn't secret-shaped). */
export function checkStaffPassword(candidate: string): boolean {
  const expected = getStaffPassword();
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createStaffSession() {
  const cookieStore = await cookies();
  cookieStore.set(
    STAFF_COOKIE_NAME,
    encode({ staff: true, exp: Date.now() + STAFF_SESSION_MAX_AGE_SECONDS * 1000 }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: STAFF_SESSION_MAX_AGE_SECONDS,
    }
  );
}

export async function clearStaffSession() {
  const cookieStore = await cookies();
  cookieStore.delete(STAFF_COOKIE_NAME);
}

export async function isStaff(): Promise<boolean> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(STAFF_COOKIE_NAME)?.value;
  if (!raw) return false;
  return decode(raw) !== null;
}
