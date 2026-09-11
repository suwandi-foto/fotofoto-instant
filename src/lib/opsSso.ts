/**
 * Outbound SSO handoff into fotofoto-ops's client portal
 * (`https://fotofoto-ops.vercel.app/portal/sso`). Same signed-payload
 * shape as session.ts/staffSession.ts (HMAC-SHA256, base64url, no JWT
 * library), but signed with a *different* secret — `FOTOFOTO_SSO_SECRET`
 * — since this token crosses into a separately-deployed app that must
 * verify it with the exact same value. Deliberately no dev-only
 * fallback here (unlike SESSION_SECRET/STAFF_PASSWORD): a fallback
 * would only work if fotofoto-ops picked the identical fallback, which
 * defeats the point of a shared secret, so this always throws if unset.
 */
import { createHmac } from "crypto";

const SSO_TOKEN_TTL_SECONDS = 60;

function getSsoSecret(): string {
  const secret = process.env.FOTOFOTO_SSO_SECRET;
  if (!secret) {
    throw new Error(
      "FOTOFOTO_SSO_SECRET is not set — required to hand a logged-in contact off to fotofoto-ops. " +
        "Generate one with `openssl rand -hex 32` and set the same value in both this app's and " +
        "fotofoto-ops's environment."
    );
  }
  return secret;
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string) {
  return createHmac("sha256", getSsoSecret()).update(payload).digest("base64url");
}

type OpsHandoffPayload = {
  opsClientId: string;
  contactName: string;
  iat: number; // unix seconds
  exp: number; // iat + SSO_TOKEN_TTL_SECONDS
};

/**
 * Mints a fresh token per call — call this at click time (see GET
 * /api/sso/ops), not when a page is rendered, since a 60-second
 * expiry baked into page HTML could lapse before the client actually
 * clicks. No replay protection beyond that short expiry (no nonce
 * store) — an accepted tradeoff for this pass, not an oversight.
 */
export function createOpsHandoffToken(opsClientId: string, contactName: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const payload: OpsHandoffPayload = {
    opsClientId,
    contactName,
    iat,
    exp: iat + SSO_TOKEN_TTL_SECONDS,
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}
