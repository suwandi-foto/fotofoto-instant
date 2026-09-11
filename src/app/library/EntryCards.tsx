import Link from "next/link";

/**
 * Two link-out entry points from design-reference/Main.dc.html. No
 * live ACTR/Communication-Health data is fetched here since that
 * screen and its scoring now live entirely in fotofoto-ops — see
 * mcmm_sessions / communication_health_data in that repo's app.py,
 * shared between its staff Client Detail page and its own client
 * portal so the two views can never disagree).
 *
 * Communication Health is gated on the client's relationshipStage
 * (Growth Partner+ only, per the confirmed scoping) — a Foundation
 * client sees a locked/upsell card instead of a link. When entitled
 * and connected, the card now routes through GET /api/sso/ops (not a
 * bare link to fotofoto-ops) — that route mints a short-lived signed
 * handoff token and redirects, landing the client on the ops portal
 * already logged in, no second credential entry (see
 * src/lib/opsSso.ts). If there's no opsClientId to hand off, the card
 * stays link-less with a "Not yet connected" subtitle, same as before
 * SSO existed.
 */

function CardShell({
  icon,
  title,
  subtitle,
  href,
  external,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  href: string | null;
  external?: boolean;
}) {
  const inner = (
    <>
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold">
        {icon}
      </div>
      <div className="min-w-0 flex-grow">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs text-text-dim">{subtitle}</div>
      </div>
      {href && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="flex-shrink-0 text-text-dim-2"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      )}
    </>
  );

  if (!href) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-panel p-3.5 opacity-50">
        {inner}
      </div>
    );
  }

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-3 rounded-2xl border border-border bg-panel p-3.5 hover:border-gold"
      >
        {inner}
      </a>
    );
  }

  return (
    <Link href={href} className="flex items-center gap-3 rounded-2xl border border-border bg-panel p-3.5 hover:border-gold">
      {inner}
    </Link>
  );
}

const pulseIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12h4l2-7 4 14 2-7h6" />
  </svg>
);

const heartIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
  </svg>
);

export function CommunicationHealthCard({
  opsClientId,
  relationshipStage,
}: {
  opsClientId: string | null;
  relationshipStage: "foundation" | "growth_partner" | "enterprise";
}) {
  const entitled = relationshipStage !== "foundation";
  const href = entitled && opsClientId ? "/api/sso/ops" : null;

  const subtitle = !entitled
    ? "Upgrade to Growth Partner to see your ACTR score and roadmap"
    : href
      ? "See your ACTR score and roadmap"
      : "Not yet connected";

  return (
    <CardShell icon={pulseIcon} title="Communication Health" subtitle={subtitle} href={href} external />
  );
}

export function FeedbackCard({ latestEventSlug }: { latestEventSlug: string | null }) {
  return (
    <CardShell
      icon={heartIcon}
      title="How was your last project?"
      subtitle={
        latestEventSlug
          ? "20 seconds · refer a friend, get Rp500k credit"
          : "No events yet"
      }
      href={latestEventSlug ? `/e/${latestEventSlug}/feedback` : null}
    />
  );
}
