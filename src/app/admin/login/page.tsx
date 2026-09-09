import { Logo } from "@/app/Logo";
import { StaffLoginForm } from "./StaffLoginForm";

export const dynamic = "force-dynamic";

/**
 * Staff-only sign-in for the admin surfaces (CEO feedback log,
 * cross-event video-notes triage). A single shared password
 * (STAFF_PASSWORD env var) — see src/lib/staffSession.ts — not
 * per-person accounts.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-14">
      <Logo className="text-sm tracking-wide" />
      <h1 className="font-display mt-3 text-2xl font-semibold">Staff sign-in</h1>
      <p className="mt-2 text-sm text-text-dim">Internal FOTOFOTO team only.</p>
      <StaffLoginForm redirectTo={next && next.startsWith("/admin") ? next : "/admin/feedback"} />
    </main>
  );
}
