import { NextRequest, NextResponse } from "next/server";
import { getCustomPreset } from "@/lib/queries";
import { getObject } from "@/lib/storage";

// The reference thumbnail for a custom preset — shown in the Control
// Room's preset manager and the photographer app's preset picker.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const preset = await getCustomPreset(id);
  if (!preset) return NextResponse.json({ error: "Preset not found" }, { status: 404 });

  const bytes = await getObject(preset.referencePath);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
