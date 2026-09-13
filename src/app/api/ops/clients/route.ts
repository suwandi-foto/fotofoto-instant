import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { timingSafeEqual } from "crypto";
import { upsertClientFromOps, AccessCodeConflictError } from "@/lib/queries";
import { relationshipStageEnum } from "@/db/schema";

/**
 * Inbound provisioning call from the separate fotofoto-ops app: when
 * staff marks a lead as a client there and clicks "Grant portal
 * access," ops calls this with a password staff already chose, and
 * this app creates (or updates) the corresponding portal login. A
 * different trust boundary from FOTOFOTO_SSO_SECRET (which only proves
 * an already-logged-in client's identity for a 60-second handoff) — this
 * secret grants the power to create/overwrite login credentials, so it
 * gets its own env var rather than reusing that one.
 */
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.FOTOFOTO_OPS_INBOUND_SECRET;
  if (!expected) {
    throw new Error(
      "FOTOFOTO_OPS_INBOUND_SECRET is not set — required for fotofoto-ops to provision client portal access."
    );
  }
  const header = req.headers.get("authorization") ?? "";
  const candidate = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// project/type/description/status are all ops's own free text (type
// and status are open catalogs ops can extend without warning us), so
// nothing here is an enum — just require non-empty strings.
const Deliverable = z.object({
  project: z.string().min(1),
  type: z.string().min(1),
  description: z.string().min(1),
  status: z.string().min(1),
});

const Body = z.object({
  opsClientId: z.string().min(1),
  companyName: z.string().min(1),
  accessCode: z.string().min(1),
  relationshipStage: z.enum(relationshipStageEnum).optional(),
  // Optional so older, already-deployed ops builds that don't send this
  // field yet keep working — treated the same as an explicit [].
  deliverables: z.array(Deliverable).optional(),
});

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { created, client } = await upsertClientFromOps(parsed.data);
    // /library is the client's home screen right after login — there's
    // no per-client gallery route (yet) to deep-link into instead.
    const portalUrl = new URL("/library", req.nextUrl.origin).toString();
    return NextResponse.json({ created, client: { ...client, portalUrl } }, { status: created ? 201 : 200 });
  } catch (err) {
    if (err instanceof AccessCodeConflictError) {
      return NextResponse.json(
        { error: "That access code is already in use by another client." },
        { status: 409 }
      );
    }
    throw err;
  }
}
