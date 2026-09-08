import { getEventBySlug } from "@/lib/queries";
import { notFound } from "next/navigation";
import { Gallery } from "./Gallery";

export const dynamic = "force-dynamic";

export default async function EventGalleryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  return (
    <Gallery
      slug={event.slug}
      initialEvent={{
        name: event.name,
        clientName: event.clientName,
        tier: event.tier,
        quota: event.quota,
        extraUnitNote: event.extraUnitNote,
      }}
    />
  );
}
