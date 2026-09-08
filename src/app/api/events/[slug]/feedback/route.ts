import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEventBySlug, createFeedback } from "@/lib/queries";
import { segmentForScore, TAGS_BY_SEGMENT, composeTestimonial } from "@/lib/feedback";

const Body = z.object({
  score: z.number().int().min(0).max(10),
  tags: z.array(z.string().min(1)).default([]),
  testimonialConsent: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { score, testimonialConsent } = parsed.data;
  const segment = segmentForScore(score);

  // Only tags that belong to this segment's own set are accepted —
  // a stale client sending another segment's tags is a bug, not a
  // real submission.
  const allowedTags = new Set(TAGS_BY_SEGMENT[segment]);
  const tags = parsed.data.tags.filter((t) => allowedTags.has(t));

  const testimonialText = segment === "promoter" ? composeTestimonial(tags) : null;

  const row = await createFeedback({
    eventId: event.id,
    score,
    segment,
    tags,
    testimonialText,
    testimonialConsent,
  });

  return NextResponse.json({ feedback: row }, { status: 201 });
}
