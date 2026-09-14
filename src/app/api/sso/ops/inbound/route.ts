import { NextRequest, NextResponse } from "next/server";
import { verifyOpsInboundToken } from "@/lib/opsSso";
import { getClientByOpsClientId } from "@/lib/queries";
import { createSession } from "@/lib/session";

/**
 * Inbound half of the SSO handoff: fotofoto-ops sends a client here
 * (via /library redirecting through this route, see LibraryPage) after
 * appending a signed token to the portalUrl it got from
 * POST /api/ops/clients, so a client already logged into Ops's own
 * /portal lands here already authenticated instead of at our
 * access-code screen. This has to be a route handler rather than
 * handled directly in /library's render — Server Components can't set
 * cookies mid-render, only Server Actions/Route Handlers can.
 *
 * Any failure (missing/bad/expired token, unknown opsClientId) just
 * redirects to /library without a session, so its own redirect to
 * /login takes over — identical to visiting /library with no token at
 * all. No error surfaced either way, per the handoff's contract.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const payload = token ? verifyOpsInboundToken(token) : null;

  if (payload) {
    const client = await getClientByOpsClientId(payload.opsClientId);
    if (client) {
      await createSession(client.id);
    }
  }

  return NextResponse.redirect(new URL("/library", req.nextUrl.origin));
}
