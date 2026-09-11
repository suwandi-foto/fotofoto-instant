/**
 * Client session cookie: signed (not encrypted — it carries no secret,
 * just an id) with HMAC-SHA256 so a client can't forge or edit it,
 * using only Node's built-in `crypto` rather than pulling in a
 * JWT/session library for one field.
 */
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { getClientById } from "./queries";

const SESSION_COOKIE_NAME = "ff_client_session";
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
    if (typeof payload.clientId !== "string") return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Sets the session cookie after a successful access-code check. */
export async function createSession(clientId: string) {
  const cookieStore = await cookies();
  const payload: SessionPayload = {
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

export type CurrentClient = {
  clientId: string;
};

/**
 * Every protected route/page's entry point for "who's logged in."
 * Re-reads the client row rather than trusting the cookie's payload
 * beyond the id, so a deactivated/changed client takes effect
 * immediately instead of only after the next login.
 */
export async function getCurrentClient(): Promise<CurrentClient | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;

  const session = decodeSession(raw);
  if (!session) return null;

  const client = await getClientById(session.clientId);
  if (!client) return null;

  return { clientId: client.id };
}
