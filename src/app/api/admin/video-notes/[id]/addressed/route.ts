import { NextResponse } from "next/server";
import { isStaff } from "@/lib/staffSession";
import { markVideoNoteAddressed } from "@/lib/queries";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isStaff())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;
  await markVideoNoteAddressed(id);
  return NextResponse.json({ ok: true });
}
