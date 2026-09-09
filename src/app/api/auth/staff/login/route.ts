import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkStaffPassword, createStaffSession } from "@/lib/staffSession";

const Body = z.object({ password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing password" }, { status: 400 });
  }
  if (!checkStaffPassword(parsed.data.password)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  await createStaffSession();
  return NextResponse.json({ ok: true });
}
