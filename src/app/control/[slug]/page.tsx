import { getEventBySlug } from "@/lib/queries";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PresetsManager } from "./PresetsManager";
import { DeliverablesManager } from "./DeliverablesManager";

export const dynamic = "force-dynamic";

export default async function EventControlPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-14">
      <div className="mb-8">
        <Link href="/" className="text-sm text-text-dim hover:text-gold">
          &larr; Control room
        </Link>
        <h1 className="font-display mt-3 text-2xl font-semibold">{event.name}</h1>
        <p className="mt-1 text-sm text-text-dim">
          Manage this event&apos;s deliverables, editing presets, and any custom looks you&apos;ve
          uploaded.
        </p>
      </div>

      <div className="flex flex-col gap-8">
        <DeliverablesManager slug={event.slug} />
        <PresetsManager slug={event.slug} />
      </div>
    </main>
  );
}
