import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/staffSession";
import {
  createClient,
  getClientById,
  setClientAccessCode,
  setClientRelationshipStage,
} from "@/lib/queries";
import { relationshipStageEnum } from "@/db/schema";

const Body = z
  .object({
    clientId: z.string().min(1).optional(),
    companyName: z.string().min(1).optional(),
    relationshipStage: z.enum(relationshipStageEnum),
    accessCode: z.string().min(1),
  })
  .refine((v) => v.clientId || v.companyName, {
    message: "Provide either clientId (existing client) or companyName (creates a new one).",
  });

/**
 * Staff-gated manual fallback for provisioning/rotating a client's
 * access code directly — see /admin/clients. The primary path is now
 * fotofoto-ops's inbound call to POST /api/ops/clients; this stays for
 * clients with no fotofoto-ops record yet, or a code rotation this app
 * has no way to request from that side.
 */
export async function POST(req: NextRequest) {
  if (!(await isStaff())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { clientId, companyName, relationshipStage, accessCode } = parsed.data;

  try {
    let client;
    if (clientId) {
      const existing = await getClientById(clientId);
      if (!existing) return NextResponse.json({ error: "Client not found" }, { status: 404 });
      await setClientRelationshipStage(clientId, relationshipStage);
      await setClientAccessCode(clientId, accessCode);
      client = await getClientById(clientId);
    } else {
      client = await createClient({ companyName: companyName!, accessCode, relationshipStage });
    }
    return NextResponse.json({ client }, { status: clientId ? 200 : 201 });
  } catch (err) {
    const code = (err as { code?: string }).code;
    const constraint = (err as { constraint?: string }).constraint;
    if (code === "23505" && constraint === "clients_access_code_unique") {
      return NextResponse.json({ error: "That access code is already in use." }, { status: 409 });
    }
    throw err;
  }
}
