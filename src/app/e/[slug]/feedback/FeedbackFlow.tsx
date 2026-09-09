"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "@/app/Logo";
import type { FeedbackScoreSegment } from "@/db/schema";
import { segmentForScore, TAGS_BY_SEGMENT, SEGMENT_COPY, THANKS_MESSAGE, composeTestimonial } from "@/lib/feedback";
import { PORTFOLIO_SHOWCASE } from "@/lib/portfolioShowcase";

type SubmittedFeedback = {
  id: string;
  segment: FeedbackScoreSegment;
  tags: string[];
};

type Voucher = {
  voucherCode: string;
  creditAmountIdr: number;
  referredName: string;
};

const SCORES = Array.from({ length: 11 }, (_, i) => i);

export function FeedbackFlow({
  slug,
  eventName,
  clientName,
}: {
  slug: string;
  eventName: string;
  clientName: string;
}) {
  const [score, setScore] = useState<number | null>(null);
  const [selectedTags, setSelectedTags] = useState<Record<string, boolean>>({});
  const [freeText, setFreeText] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmittedFeedback | null>(null);

  const [referredName, setReferredName] = useState("");
  const [referredContact, setReferredContact] = useState("");
  const [referralSubmitting, setReferralSubmitting] = useState(false);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [copied, setCopied] = useState(false);

  const segment = score === null ? null : segmentForScore(score);
  const availableTags = segment ? TAGS_BY_SEGMENT[segment] : [];
  const pickedTags = availableTags.filter((t) => selectedTags[t]);

  function pickScore(v: number) {
    setScore(v);
    setSelectedTags({});
    setFreeText("");
    setConsent(false);
    setResult(null);
    setError(null);
    setVoucher(null);
    setReferredName("");
    setReferredContact("");
    setReferralError(null);
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => ({ ...prev, [tag]: !prev[tag] }));
  }

  async function submit() {
    if (score === null || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${slug}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score,
          tags: pickedTags,
          freeText: freeText.trim() || undefined,
          testimonialConsent: consent,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not send feedback");
      const data = await res.json();
      setResult({
        id: data.feedback.id,
        segment: data.feedback.segment,
        tags: JSON.parse(data.feedback.tags),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReferral(e: React.FormEvent) {
    e.preventDefault();
    if (!result || referralSubmitting || !referredName.trim()) return;
    setReferralSubmitting(true);
    setReferralError(null);
    try {
      const res = await fetch(`/api/events/${slug}/feedback/${result.id}/referral`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referredName: referredName.trim(),
          referredContact: referredContact.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not submit referral");
      setVoucher(await res.json());
    } catch (err) {
      setReferralError((err as Error).message);
    } finally {
      setReferralSubmitting(false);
    }
  }

  function copyCode() {
    if (!voucher) return;
    navigator.clipboard
      ?.writeText(voucher.voucherCode)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  const waHref = voucher
    ? `https://wa.me/?text=${encodeURIComponent(
        `Hi — I worked with FOTOFOTO on our last project and thought of you. Use my code ${voucher.voucherCode} when you reach out to them.`
      )}`
    : "#";

  const segmentCopy = segment ? SEGMENT_COPY[segment] : null;
  // A promoter's own words take priority over the tags-composed
  // sentence, same rule the server applies when it saves
  // testimonialText — see POST /api/events/[slug]/feedback.
  const trimmedFreeText = freeText.trim();
  const testimonialPreview =
    trimmedFreeText.length > 0
      ? trimmedFreeText
      : pickedTags.length > 0
        ? composeTestimonial(pickedTags)
        : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col pb-10">
      <div className="flex flex-col gap-3 border-b border-border px-5 pb-4 pt-6">
        <Link href={`/e/${slug}`}>
          <Logo className="text-sm tracking-wide" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-semibold leading-tight">How did we do?</h1>
          <p className="mt-1 text-sm text-text-dim">
            {eventName} · Takes 20 seconds — and helps our next project with you go even better.
          </p>
        </div>
      </div>

      {/* NPS score row */}
      <div className="flex flex-col gap-2.5 px-5 pb-1 pt-5">
        <div className="text-sm font-bold">
          How likely are you to recommend FOTOFOTO to a colleague?
        </div>
        <div className="flex gap-1">
          {SCORES.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => pickScore(v)}
              className="h-9 flex-1 rounded-md border text-xs font-extrabold"
              style={
                v === score
                  ? { borderColor: "var(--color-gold)", background: "var(--color-gold)", color: "#000000" }
                  : { borderColor: "var(--color-border)", background: "var(--color-panel)", color: "var(--color-text-dim)" }
              }
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex justify-between text-[10px] font-semibold text-text-dim-2">
          <span>Not likely</span>
          <span>Extremely likely</span>
        </div>
      </div>

      {/* Portfolio browsing strip — visible from the moment the screen
          loads, not gated behind submitting the score. */}
      <div className="flex flex-col gap-2.5 pb-1 pt-6">
        <div className="px-5 text-sm font-bold font-display">While you&apos;re here — more of our work</div>
        <div className="flex gap-2.5 overflow-x-auto px-5 pb-1" style={{ scrollbarWidth: "none" }}>
          {PORTFOLIO_SHOWCASE.map((p) => (
            <div
              key={p.id}
              className="relative h-[110px] w-40 flex-shrink-0 overflow-hidden rounded-2xl border border-border"
              style={{ background: p.gradient }}
            >
              <div className="absolute bottom-2 left-2.5 right-2.5">
                <div className="text-xs font-bold leading-tight text-text">{p.title}</div>
                <div className="mt-0.5 text-[10px] font-semibold text-text-dim">{p.tag}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Segment follow-up card */}
      {segment && segmentCopy && !result && (
        <div className="px-5 pt-6">
          <div className="flex flex-col gap-3.5 rounded-2xl border border-border bg-panel p-4">
            <div>
              <div className="font-display text-[15px] font-bold">{segmentCopy.headline}</div>
              <div className="mt-1 text-xs leading-snug text-text-dim">{segmentCopy.subhead}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableTags.map((tag) => {
                const on = !!selectedTags[tag];
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className="rounded-full border px-3.5 py-2 text-[11.5px] font-bold"
                    style={
                      on
                        ? { borderColor: "var(--color-gold)", background: "var(--color-gold-soft)", color: "var(--color-gold)" }
                        : { borderColor: "var(--color-border)", background: "var(--color-panel-2)", color: "var(--color-text-dim)" }
                    }
                  >
                    {tag}
                  </button>
                );
              })}
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold text-text-dim-2">
                Anything else you&apos;d like to say? (optional)
              </span>
              <textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="In your own words…"
                className="rounded-xl border border-border bg-panel-2 px-3.5 py-3 text-sm text-text placeholder:text-text-dim-2 focus:border-gold focus:outline-none"
              />
            </label>

            {segment === "promoter" && testimonialPreview && (
              <div className="flex flex-col gap-1.5 rounded-xl border border-gold/35 bg-panel-2 p-3">
                <div className="text-[11px] font-extrabold uppercase tracking-wide text-gold">
                  Will be shared as a quote
                </div>
                <div className="text-[12.5px] italic leading-snug text-text">&ldquo;{testimonialPreview}&rdquo;</div>
                <div className="text-[11px] font-semibold text-text-dim-2">— {clientName}</div>
                <label className="mt-1 flex items-start gap-2 text-[11px] leading-snug text-text-dim">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 accent-gold"
                  />
                  I&apos;m OK with FOTOFOTO publishing this quote alongside {clientName}&apos;s name. Nothing is
                  published until we follow up and you confirm.
                </label>
              </div>
            )}

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="rounded-xl bg-gold py-3.5 text-[13px] font-extrabold text-gold-ink disabled:opacity-50"
            >
              {submitting ? "Sending…" : "Send feedback"}
            </button>
          </div>
        </div>
      )}

      {/* Post-submit: thank-you */}
      {result && (result.segment === "promoter" || result.segment === "passive") && (
        <div className="px-5 pt-6">
          <div
            className="flex items-center gap-3 rounded-2xl border border-border p-4"
            style={{ background: "linear-gradient(155deg, var(--color-panel-2), var(--color-panel))" }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="m9 12 2 2 4-4" />
              <circle cx="12" cy="12" r="9" />
            </svg>
            <div className="text-[13px] font-bold leading-snug">{THANKS_MESSAGE[result.segment]}</div>
          </div>
        </div>
      )}

      {/* Post-submit: service recovery for detractors */}
      {result && result.segment === "detractor" && (
        <div className="px-5 pt-6">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-panel p-3.5">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-panel-2 text-xs font-extrabold text-gold">
              FF
            </div>
            <div>
              <div className="text-[12.5px] font-bold">Our team will reach out within 24 hours</div>
              <div className="mt-0.5 text-[11px] text-text-dim">On WhatsApp, to talk through what went wrong.</div>
            </div>
          </div>
        </div>
      )}

      {/* Referral + instant voucher — promoters only */}
      {result && result.segment === "promoter" && (
        <div className="px-5 pt-3.5">
          <div className="flex flex-col gap-3.5 rounded-2xl border border-gold/35 bg-panel p-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[10px] bg-gold-soft text-gold">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 7h-3.5a2.5 2.5 0 1 0-2.5 2.5H20Zm0 0v4H4V7h4" />
                  <path d="M4 11v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8M12 4a2.5 2.5 0 1 0-2.5 2.5H12Z" />
                </svg>
              </div>
              <div>
                <div className="font-display text-[14.5px] font-bold">Know a manufacturer we should meet?</div>
                <div className="mt-0.5 text-[11.5px] text-text-dim">
                  Refer them — get Rp500k credit the moment they sign on.
                </div>
              </div>
            </div>

            {!voucher ? (
              <form onSubmit={submitReferral} className="flex flex-col gap-2.5">
                <input
                  type="text"
                  required
                  value={referredName}
                  onChange={(e) => setReferredName(e.target.value)}
                  placeholder="Company or contact name"
                  className="rounded-xl border border-border bg-panel-2 px-3.5 py-3 text-sm text-text placeholder:text-text-dim-2 focus:border-gold focus:outline-none"
                />
                <input
                  type="text"
                  value={referredContact}
                  onChange={(e) => setReferredContact(e.target.value)}
                  placeholder="WhatsApp number or email (optional)"
                  className="rounded-xl border border-border bg-panel-2 px-3.5 py-3 text-sm text-text placeholder:text-text-dim-2 focus:border-gold focus:outline-none"
                />
                {referralError && <p className="text-xs text-red-400">{referralError}</p>}
                <button
                  type="submit"
                  disabled={referralSubmitting || !referredName.trim()}
                  className="rounded-xl bg-gold py-3 text-[12.5px] font-extrabold text-gold-ink disabled:opacity-50"
                >
                  {referralSubmitting ? "Generating…" : "Get my referral code"}
                </button>
              </form>
            ) : (
              <div
                className="flex flex-col gap-2.5 rounded-2xl border border-dashed p-3.5"
                style={{
                  borderColor: "var(--color-gold-border)",
                  background: "linear-gradient(155deg, rgba(214,138,60,0.16), rgba(214,138,60,0.04))",
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-extrabold uppercase tracking-wide text-gold">Voucher ready</div>
                  <div className="text-[10.5px] text-text-dim">for {voucher.referredName}</div>
                </div>
                <div className="flex items-center justify-between gap-2.5">
                  <div className="font-display text-xl font-bold tracking-wide">{voucher.voucherCode}</div>
                  <button
                    type="button"
                    onClick={copyCode}
                    className="rounded-lg border border-border bg-panel-2 px-2.5 py-1.5 text-[10.5px] font-bold text-text"
                  >
                    {copied ? "Copied" : "Copy code"}
                  </button>
                </div>
                <p className="text-[11px] leading-snug text-text-dim">
                  Rp{voucher.creditAmountIdr.toLocaleString("id-ID")} credit lands on your account once{" "}
                  {voucher.referredName} signs a Foundation package or larger. We&apos;ll reach out to them and
                  mention your name.
                </p>
                <a
                  href={waHref}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 rounded-[10px] py-2.5 text-[12.5px] font-extrabold"
                  style={{ background: "var(--color-success)", color: "#06210f" }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#06210f" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
                  </svg>
                  Share via WhatsApp
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
