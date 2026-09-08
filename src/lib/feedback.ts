import type { FeedbackScoreSegment } from "@/db/schema";

/** 9-10 = promoter, 7-8 = passive, 0-6 = detractor — the standard NPS split. */
export function segmentForScore(score: number): FeedbackScoreSegment {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

export const TAGS_BY_SEGMENT: Record<FeedbackScoreSegment, string[]> = {
  promoter: ["Speed", "Creative direction", "Communication", "Final quality", "Team on-site"],
  passive: ["Faster turnaround", "More proactive updates", "Better source files", "Pricing flexibility"],
  detractor: ["Missed deadline", "Communication", "Quality", "Price", "Other"],
};

export const SEGMENT_COPY: Record<FeedbackScoreSegment, { headline: string; subhead: string }> = {
  promoter: {
    headline: "That's fantastic to hear!",
    subhead: "What stood out most? Pick a couple — we may quote you (with your OK).",
  },
  passive: {
    headline: "Good to know — what would make it a 10?",
    subhead: "A few honest words help us get there on the next project.",
  },
  detractor: {
    headline: "We're sorry to hear that.",
    subhead: "What went wrong? This goes straight to our team, not just a log.",
  },
};

export const THANKS_MESSAGE: Record<"promoter" | "passive", string> = {
  promoter: "Thank you — this made our day. Your feedback below will help other manufacturers find us.",
  passive: "Thanks for the honest feedback — noted for our next project together.",
};

/** Composes the picked tags into the sentence shown as a "will be
 * shared as a quote" preview — matches the approved mockup's phrasing. */
export function composeTestimonial(tags: string[]): string {
  if (tags.length === 0) return "A great experience working with the FOTOFOTO team.";
  return `${tags.join(" and ")} stood out most.`;
}
