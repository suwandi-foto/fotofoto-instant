import Link from "next/link";

/**
 * Two link-out entry points from design-reference/Main.dc.html,
 * scoped down to plain links (no session/auto-login into fotofoto-ops
 * — that's the confirmed single-sign-on non-goal for this pass, and
 * no live ACTR/Communication-Health data is fetched here since that
 * screen and its scoring now live entirely in fotofoto-ops).
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

export function CommunicationHealthCard({ opsClientId }: { opsClientId: string | null }) {
  const href = opsClientId
    ? `https://fotofoto-ops.vercel.app/portal/projects/${opsClientId}`
    : null;

  return (
    <CardShell
      icon={pulseIcon}
      title="Communication Health"
      subtitle={href ? "See your ACTR score and roadmap" : "Not yet connected"}
      href={href}
      external
    />
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
