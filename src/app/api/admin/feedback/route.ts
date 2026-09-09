import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isStaff } from "@/lib/staffSession";
import { createAdminFeedback } from "@/lib/queries";

const Body = z.object({
  authorLabel: z.string().min(1),
  text: z.string().min(1),
});

/** POST: staff submits a free-text note for the CEO to review — see
 * schema.ts's adminFeedback comment for why this mirrors fotofoto-ops's
 * feedback_requests table/review-page shape rather than a VS Code file. */
export async function POST(req: NextRequest) {
  if (!(await isStaff())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const row = await createAdminFeedback(parsed.data);
  return NextResponse.json({ feedback: row }, { status: 201 });
}
