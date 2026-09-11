import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientByAccessCode } from "@/lib/queries";
import { createSession } from "@/lib/session";

const Body = z.object({ accessCode: z.string().min(1) });

/**
 * Single-step client login: the access code is a standing credential
 * — one shared code per client company, chosen by staff in fotofoto-ops
 * and provisioned here via POST /api/ops/clients (or set directly via
 * /admin/clients) — not a single-use token. Anyone at that client can
 * log in with it repeatedly, from any device, until staff rotates it.
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

  const client = await getClientByAccessCode(parsed.data.accessCode);
  if (!client) {
    return NextResponse.json({ error: "That code isn't valid." }, { status: 401 });
  }

  await createSession(client.id);
  return NextResponse.json({ ok: true });
}
