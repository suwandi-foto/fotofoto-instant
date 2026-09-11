import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createClient,
  getClientById,
  setClientAccessCode,
  setClientRelationshipStage,
} from "@/lib/queries";
import { relationshipStageEnum } from "@/db/schema";

/**
 * DEV-ONLY: seeds a client (one shared access code, no per-person
 * contact) so the login flow has something to log in as. There is no
 * FOTOFOTO-staff-facing UI for this beyond /admin/clients — this is a
 * faster stand-in for local dev, and it must not be reachable in
 * production.
 *
 * Pass `clientId` to update an existing client's code/stage, or
 * `companyName` + `accessCode` to create a new one. `relationshipStage`
 * (default "foundation") gates the Communication Health card — see
 * EntryCards.tsx.
 */
const Body = z
  .object({
    clientId: z.string().min(1).optional(),
    companyName: z.string().min(1).optional(),
    opsClientId: z.string().min(1).optional(),
    accessCode: z.string().min(1),
    relationshipStage: z.enum(relationshipStageEnum).optional(),
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
  const { clientId, companyName, opsClientId, accessCode, relationshipStage } = parsed.data;

  let resolvedClientId = clientId ?? null;
  if (resolvedClientId) {
    const existing = await getClientById(resolvedClientId);
    if (!existing) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    if (relationshipStage) await setClientRelationshipStage(resolvedClientId, relationshipStage);
    await setClientAccessCode(resolvedClientId, accessCode);
  } else {
    const client = await createClient({ companyName: companyName!, accessCode, opsClientId, relationshipStage });
    resolvedClientId = client!.id;
  }

  const client = await getClientById(resolvedClientId);
  return NextResponse.json({ client }, { status: clientId ? 200 : 201 });
}
