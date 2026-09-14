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
 *
 * Redirects with a plain relative Location header rather than
 * `NextResponse.redirect(new URL("/library", req.nextUrl.origin))`:
 * behind this app's production reverse proxy, the incoming Host header
 * isn't the public domain, so `req.nextUrl.origin` resolves to the
 * server's own bind address and produces an unreachable absolute URL.
 * A relative Location header sidesteps that — browsers resolve it
 * against the request they actually made, same as how `redirect()`
 * from next/navigation already behaves elsewhere in this app.
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

  return new NextResponse(null, { status: 307, headers: { Location: "/library" } });
}
