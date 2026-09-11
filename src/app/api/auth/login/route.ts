import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContactByAccessCode } from "@/lib/queries";
import { createSession } from "@/lib/session";

const Body = z.object({ accessCode: z.string().min(1) });

/**
 * Single-step client-contact login: the access code is a standing
 * credential FOTOFOTO staff hand to the contact directly (see POST
 * /api/admin/clients), not a single-use token — a contact can log in
 * with it repeatedly, from any device, until staff issues a new one.
 *
 * The rejection message is deliberately the same generic "not valid"
 * whether the code is unknown or just malformed, so guessing gets no
 * signal either way.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That code isn't valid." }, { status: 400 });
  }

  const contact = await getContactByAccessCode(parsed.data.accessCode);
  if (!contact) {
    return NextResponse.json({ error: "That code isn't valid." }, { status: 401 });
  }

  await createSession(contact.id, contact.clientId);
  return NextResponse.json({ ok: true });
}
