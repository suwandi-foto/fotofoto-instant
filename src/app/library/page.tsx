import { redirect } from "next/navigation";
import { Logo } from "@/app/Logo";
import { getCurrentClient } from "@/lib/session";
import { listClientEvents, getClientById, isEventArchived, listClientDeliverables } from "@/lib/queries";
import { LogoutButton } from "./LogoutButton";
import { EventLibrary } from "./EventLibrary";
import { CommunicationHealthCard, FeedbackCard } from "./EntryCards";
import { DeliverablesSection } from "./DeliverablesSection";

export const dynamic = "force-dynamic";

/**
 * The client home screen after login: their event library, plus
 * link-outs to Communication Health and Feedback/NPS (both of which
 * live in the separate fotofoto-ops app — see EntryCards.tsx). The
 * Shop row (Calendar/Wall Print/Timeline) from the mockup is skipped —
 * commerce isn't built anywhere in this project yet.
 *
 * This is also the landing spot for the inbound SSO handoff from
 * fotofoto-ops (the reverse of the Communication Health card's
 * outbound one): Ops appends `?token=` to this exact URL, since it's
 * the `portalUrl` returned from POST /api/ops/clients. A Server
 * Component can't set the session cookie itself mid-render, so an
 * unauthenticated visit carrying a token gets redirected through
 * /api/sso/ops/inbound, which verifies it and establishes the session
 * before sending the client back here. No token, or an already-active
 * session, and this behaves exactly as before.
 */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const session = await getCurrentClient();
  if (!session) {
    if (token) redirect(`/api/sso/ops/inbound?token=${encodeURIComponent(token)}`);
    redirect("/login");
  }

  const [client, events, deliverables] = await Promise.all([
    getClientById(session.clientId),
    listClientEvents(session.clientId),
    listClientDeliverables(session.clientId),
  ]);

  const eventRows = events.map((e) => ({
    id: e.id,
    slug: e.slug,
    name: e.name,
    tier: e.tier,
    quota: e.quota,
    archived: isEventArchived(e.createdAt),
  }));

  // listClientEvents orders newest-first, so this is the client's most
  // recently created event — used as "your last project" for the
  // feedback card's target.
  const latestEventSlug = events[0]?.slug ?? null;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-14">
      <div className="mb-8 flex items-start justify-between">
        <Logo className="text-sm tracking-wide" />
        <LogoutButton />
      </div>

      <div className="mb-8">
        <h1 className="font-display text-2xl font-semibold">
          {client?.companyName ?? "Your account"}
        </h1>
      </div>

      <div className="mb-8">
        <EventLibrary events={eventRows} />
      </div>

      <div className="mb-8">
        <DeliverablesSection deliverables={deliverables} />
      </div>

      <div className="flex flex-col gap-2.5">
        <CommunicationHealthCard
          opsClientId={client?.opsClientId ?? null}
          relationshipStage={client?.relationshipStage ?? "foundation"}
        />
        <FeedbackCard latestEventSlug={latestEventSlug} />
      </div>
    </main>
  );
}
