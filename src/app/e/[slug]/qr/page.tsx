import { getEventBySlug } from "@/lib/queries";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Logo } from "@/app/Logo";

export default async function EventQrPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  // In production this would encode the real public URL; here it
  // encodes the path so it's testable inside the dev sandbox too.
  const galleryPath = `/e/${event.slug}`;
  const qrDataUrl = await QRCode.toDataURL(galleryPath, {
    margin: 1,
    width: 480,
    color: { dark: "#000000", light: "#edeff1" },
  });

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-6 py-14 text-center">
      <Logo className="text-sm tracking-wide" />
      <h1 className="font-display text-2xl font-semibold">{event.name}</h1>
      <p className="text-sm text-text-dim">
        {event.tier === "full_access"
          ? "Scan to browse and download every photo."
          : "This is the client link — scan to view, pick, and finalize your photos."}
      </p>
      <div className="rounded-md border border-border bg-panel p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrDataUrl} alt={`QR code for ${event.name}`} width={280} height={280} />
      </div>
      <div className="rounded-sm border border-border bg-panel-2 px-4 py-2 font-mono text-xs text-text-dim">
        {galleryPath}
      </div>
    </main>
  );
}
