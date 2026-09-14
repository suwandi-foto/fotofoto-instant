import { NextResponse } from "next/server";
import { getCurrentClient } from "@/lib/session";
import { getClientById } from "@/lib/queries";
import { createOpsHandoffToken } from "@/lib/opsSso";

const OPS_PORTAL_ORIGIN = "https://fotofoto-ops.vercel.app";

/**
 * Click-time SSO handoff behind the Communication Health card (see
 * CommunicationHealthCard in library/EntryCards.tsx). Mints the
 * signed token fresh on every click rather than baking one into
 * /library's page HTML — its 60-second expiry (see
 * createOpsHandoffToken) could otherwise lapse before the client
 * actually clicks. Re-checks entitlement/opsClientId server-side
 * rather than trusting the card's own gating, in case this is ever
 * hit directly or from stale cached HTML.
 *
 * The two same-origin redirects below use a plain relative Location
 * header instead of NextResponse.redirect(new URL(path,
 * req.nextUrl.origin)): behind this app's production reverse proxy,
 * the incoming Host header isn't the public domain, so
 * req.nextUrl.origin resolves to the server's own bind address and
 * produces an unreachable absolute URL. A relative Location header
 * sidesteps that — browsers resolve it against the request they
 * actually made.
 */
export async function GET() {
  const session = await getCurrentClient();
  if (!session) {
    return new NextResponse(null, { status: 307, headers: { Location: "/login" } });
  }

  const client = await getClientById(session.clientId);
  const entitled = client != null && client.relationshipStage !== "foundation";
  if (!entitled || !client.opsClientId) {
    // Nothing to hand off to — same "not yet connected" situation the
    // card itself renders as a disabled, link-less entry.
    return new NextResponse(null, { status: 307, headers: { Location: "/library" } });
  }

  const token = createOpsHandoffToken(client.opsClientId, client.companyName);
  return NextResponse.redirect(`${OPS_PORTAL_ORIGIN}/portal/sso?token=${token}`);
}
