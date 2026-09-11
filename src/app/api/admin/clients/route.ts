import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/staffSession";
import {
  createClient,
  createClientContact,
  getClientById,
  setClientRelationshipStage,
} from "@/lib/queries";
import { relationshipStageEnum } from "@/db/schema";

const Body = z
  .object({
    clientId: z.string().min(1).optional(),
    companyName: z.string().min(1).optional(),
    relationshipStage: z.enum(relationshipStageEnum),
    name: z.string().min(1),
    department: z.string().min(1),
    email: z.email(),
  })
  .refine((v) => v.clientId || v.companyName, {
    message: "Provide either clientId (existing client) or companyName (creates a new one).",
  });

/**
 * Staff-gated replacement for the dev-only POST /api/dev/contacts
 * seeding route (which is hard-disabled in production, on purpose —
 * it has no auth of its own). Same underlying logic, just behind real
 * staff auth so it works identically in production: create/reuse a
 * client, add a named contact, and hand back the generated access
 * code for staff to copy and send to the client (see /admin/clients).
 */
export async function POST(req: NextRequest) {
  if (!(await isStaff())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { clientId, companyName, relationshipStage, name, department, email } = parsed.data;

  let resolvedClientId = clientId ?? null;
  if (resolvedClientId) {
    const existing = await getClientById(resolvedClientId);
    if (!existing) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    await setClientRelationshipStage(resolvedClientId, relationshipStage);
  } else {
    const client = await createClient({ companyName: companyName!, relationshipStage });
    resolvedClientId = client!.id;
  }

  try {
    const contact = await createClientContact({ clientId: resolvedClientId, name, department, email });
    return NextResponse.json({ contact }, { status: 201 });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json({ error: "A contact with that email already exists." }, { status: 409 });
    }
    throw err;
  }
}
