import { NextRequest, NextResponse } from "next/server";
import { getCurrentContact } from "@/lib/session";
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
 */
export async function GET(req: NextRequest) {
  const contact = await getCurrentContact();
  if (!contact) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  const client = await getClientById(contact.clientId);
  const entitled = client != null && client.relationshipStage !== "foundation";
  if (!entitled || !client.opsClientId) {
    // Nothing to hand off to — same "not yet connected" situation the
    // card itself renders as a disabled, link-less entry.
    return NextResponse.redirect(new URL("/library", req.nextUrl.origin));
  }

  const token = createOpsHandoffToken(client.opsClientId, contact.name);
  return NextResponse.redirect(`${OPS_PORTAL_ORIGIN}/portal/sso?token=${token}`);
}
