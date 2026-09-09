import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createClientContact, getClientById } from "@/lib/queries";

/**
 * DEV-ONLY: seeds a client contact so the login flow has something to
 * log in as. There is no FOTOFOTO-staff-facing "add a contact" UI yet
 * (future work) — this is the stand-in until that exists, and it must
 * not be reachable in production.
 *
 * Pass `clientId` to add a contact to an existing client, or
 * `companyName` to create a new client first.
 */
const Body = z
  .object({
    clientId: z.string().min(1).optional(),
    companyName: z.string().min(1).optional(),
    opsClientId: z.string().min(1).optional(),
    name: z.string().min(1),
    department: z.string().min(1),
    email: z.email(),
  })
  .refine((v) => v.clientId || v.companyName, {
    message: "Provide either clientId (existing client) or companyName (creates a new one).",
  });

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { clientId, companyName, opsClientId, name, department, email } = parsed.data;

  let resolvedClientId = clientId ?? null;
  if (resolvedClientId) {
    const existing = await getClientById(resolvedClientId);
    if (!existing) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  } else {
    const client = await createClient({ companyName: companyName!, opsClientId });
    resolvedClientId = client!.id;
  }

  const contact = await createClientContact({
    clientId: resolvedClientId,
    name,
    department,
    email,
  });

  return NextResponse.json({ contact }, { status: 201 });
}
