import { NextRequest, NextResponse } from "next/server";
import { consumeAuthToken } from "@/lib/queries";
import { createSession } from "@/lib/session";

/**
 * Validates + single-use-consumes a login token from a request-link
 * email (see POST /api/auth/request-link), sets the session cookie,
 * and lands the contact on the library hub. An invalid, expired, or
 * already-used token bounces back to /login with an error flag rather
 * than a bare error response, since this is always hit by a browser
 * navigation (an email link click), not a fetch call.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const contact = token ? await consumeAuthToken(token) : null;

  if (!contact) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", req.nextUrl.origin));
  }

  await createSession(contact.id, contact.clientId);
  return NextResponse.redirect(new URL("/library", req.nextUrl.origin));
}
