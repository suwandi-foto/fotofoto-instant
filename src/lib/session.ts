/**
 * Client-contact session cookie: signed (not encrypted — it carries
 * no secret, just ids) with HMAC-SHA256 so a client can't forge or
 * edit it, using only Node's built-in `crypto` rather than pulling in
 * a JWT/session library for two fields.
 */
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { getContactById } from "./queries";

const SESSION_COOKIE_NAME = "ff_contact_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Checked lazily (inside sign(), not at module load) so a production
// *build* — which sets NODE_ENV=production without necessarily having
// runtime secrets available yet — doesn't fail just for importing this
// module; a production *request* to sign/verify a cookie without a
// real secret set still throws.
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

type SessionPayload = {
  contactId: string;
  clientId: string;
  exp: number; // epoch ms
};

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function encodeSession(payload: SessionPayload): string {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

function decodeSession(raw: string): SessionPayload | null {
  const [body, signature] = raw.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.contactId !== "string" || typeof payload.clientId !== "string") return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Sets the session cookie after a successful token consume. */
export async function createSession(contactId: string, clientId: string) {
  const cookieStore = await cookies();
  const payload: SessionPayload = {
    contactId,
    clientId,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };
  cookieStore.set(SESSION_COOKIE_NAME, encodeSession(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export type CurrentContact = {
  contactId: string;
  clientId: string;
  name: string;
  department: string;
};

/**
 * Every protected route/page's entry point for "who's logged in."
 * Re-reads the contact row rather than trusting name/department out
 * of the cookie, so an edited contact record takes effect immediately
 * instead of only after the next login.
 */
export async function getCurrentContact(): Promise<CurrentContact | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;

  const session = decodeSession(raw);
  if (!session) return null;

  const contact = await getContactById(session.contactId);
  if (!contact || contact.clientId !== session.clientId) return null;

  return {
    contactId: contact.id,
    clientId: contact.clientId,
    name: contact.name,
    department: contact.department,
  };
}

/**
 * The "You" convention used everywhere a comment/note/reaction shows
 * its author (Photo Detail pins, Video Review notes, ...): the
 * currently logged-in contact sees their own name as "You" instead of
 * their real name, matching design-reference/PhotoDetail.dc.html and
 * VideoReview.dc.html.
 */
export function formatAuthorName(
  authorContactId: string,
  authorName: string,
  currentContactId: string | null | undefined
): string {
  return currentContactId != null && authorContactId === currentContactId ? "You" : authorName;
}
