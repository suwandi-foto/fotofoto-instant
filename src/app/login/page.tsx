import { Logo } from "@/app/Logo";
import { RequestLinkForm } from "./RequestLinkForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-14">
      <Logo className="text-sm tracking-wide" />
      <h1 className="font-display mt-3 text-2xl font-semibold">Client login</h1>
      <p className="mt-2 text-sm text-text-dim">
        Enter the email your event contact was registered with — we&apos;ll send a one-time login
        link.
      </p>

      {error === "invalid_token" && (
        <p className="mt-4 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-400">
          That login link is invalid, expired, or already used. Request a new one below.
        </p>
      )}

      <RequestLinkForm />
    </main>
  );
}
