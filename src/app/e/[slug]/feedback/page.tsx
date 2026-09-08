import { getEventBySlug } from "@/lib/queries";
import { notFound } from "next/navigation";
import { FeedbackFlow } from "./FeedbackFlow";

export const dynamic = "force-dynamic";

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  return (
    <FeedbackFlow
      slug={event.slug}
      eventName={event.name}
      clientName={event.clientName}
    />
  );
}
