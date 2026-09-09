import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContactByEmail, createAuthToken } from "@/lib/queries";

const Body = z.object({ email: z.email() });

/**
 * Issues a single-use login link for a client contact.
 *
 * DEV-ONLY STAND-IN: there is no real email delivery yet, so the raw
 * link is returned directly in the response body (`loginUrl`) instead
 * of being sent anywhere. Wire this up to actual email delivery
 * before this is ever exposed outside internal/dev use — as written,
 * anyone who can call this endpoint can log in as the contact.
 *
 * The response message is worded the same whether or not the email
 * matches a contact, so a client can't probe which addresses are
 * registered. `loginUrl` is unavoidably null vs. present depending on
 * that match (there's no link to hand back for an unknown contact) —
 * that's an accepted consequence of returning the link inline for now
 * rather than emailing it; it goes away once real delivery replaces
 * this stand-in.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const contact = await getContactByEmail(parsed.data.email);

  let loginUrl: string | null = null;
  if (contact) {
    const { token } = await createAuthToken(contact.id);
    loginUrl = new URL(`/api/auth/consume?token=${token}`, req.nextUrl.origin).toString();
  }

  return NextResponse.json({
    ok: true,
    message: "If a client contact is registered with that email, a login link has been created.",
    loginUrl,
  });
}
