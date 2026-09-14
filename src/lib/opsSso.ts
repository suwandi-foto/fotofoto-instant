/**
 * SSO handoff between this app and fotofoto-ops's client portal, in
 * both directions: outbound (createOpsHandoffToken, into
 * `https://fotofoto-ops.vercel.app/portal/sso`) and inbound
 * (verifyOpsInboundToken, for tokens Ops appends to the portalUrl it
 * got from POST /api/ops/clients). Same signed-payload shape as
 * session.ts/staffSession.ts (HMAC-SHA256, base64url, no JWT library),
 * but signed with a *different* secret — `FOTOFOTO_SSO_SECRET` — since
 * these tokens cross into a separately-deployed app that must
 * sign/verify with the exact same value. Deliberately no dev-only
 * fallback here (unlike SESSION_SECRET/STAFF_PASSWORD): a fallback
 * would only work if fotofoto-ops picked the identical fallback, which
 * defeats the point of a shared secret, so this always throws if unset.
 */
import { createHmac, timingSafeEqual } from "crypto";

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
  // Wire field name kept as `contactName` for now even though this
  // repo dropped per-person contacts: it now carries the client's
  // companyName instead. Renaming the key would need a simultaneous
  // deploy on fotofoto-ops's side (the verifier there reads this
  // field), so that rename is deferred to a coordinated change across
  // both repos rather than bundled into this one.
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
export function createOpsHandoffToken(opsClientId: string, companyName: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const payload: OpsHandoffPayload = {
    opsClientId,
    contactName: companyName,
    iat,
    exp: iat + SSO_TOKEN_TTL_SECONDS,
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

type OpsInboundPayload = {
  opsClientId: string;
  companyName: string;
  iat: number;
  exp: number;
};

/**
 * Verifies a token minted by fotofoto-ops for the reverse handoff (a
 * client already logged into Ops's own /portal, clicking through to
 * here). Mirrors createOpsHandoffToken's shape and secret in the
 * opposite direction. Returns null for any failure — bad format, bad
 * signature, or expired — rather than throwing, since the caller's
 * contract is to fall through to the normal access-code login on any
 * problem instead of surfacing an error.
 */
export function verifyOpsInboundToken(token: string): OpsInboundPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OpsInboundPayload;
    if (typeof payload.opsClientId !== "string" || typeof payload.companyName !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
