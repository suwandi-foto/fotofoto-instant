import { getEventBySlug } from "@/lib/queries";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PresetsManager } from "./PresetsManager";

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
          Editing presets for this event — what the photographer app offers, and any custom looks
          you&apos;ve uploaded.
        </p>
      </div>

      <PresetsManager slug={event.slug} />
    </main>
  );
}
