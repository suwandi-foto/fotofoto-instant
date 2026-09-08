import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEventBySlug, getFeedback, createReferral } from "@/lib/queries";

const Body = z.object({
  referredName: z.string().min(1),
  referredContact: z.string().min(1).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const feedback = await getFeedback(id);
  if (!feedback || feedback.eventId !== event.id) {
    return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
  }
  if (feedback.segment !== "promoter") {
    return NextResponse.json(
      { error: "Referrals are only available for promoter feedback." },
      { status: 400 }
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const referral = await createReferral({
    feedbackId: feedback.id,
    eventId: event.id,
    referredName: parsed.data.referredName,
    referredContact: parsed.data.referredContact ?? null,
  });

  return NextResponse.json(
    {
      voucherCode: referral!.voucherCode,
      creditAmountIdr: referral!.creditAmountIdr,
      referredName: referral!.referredName,
    },
    { status: 201 }
  );
}
