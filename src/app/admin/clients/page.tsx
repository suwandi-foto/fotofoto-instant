import { redirect } from "next/navigation";
import { Logo } from "@/app/Logo";
import { isStaff } from "@/lib/staffSession";
import { listClients } from "@/lib/queries";
import { ClientAccessCodeForm } from "./ClientAccessCodeForm";

export const dynamic = "force-dynamic";

/**
 * Manual fallback for provisioning or rotating a client's portal
 * access code directly from this app — see POST /api/admin/clients.
 * The primary path is now fotofoto-ops's "Grant portal access" flow
 * (POST /api/ops/clients), which this app has no way to trigger a
 * "please rotate" signal back to, so this page stays as the
 * staff-initiated escape hatch for both new and existing clients.
 */
export default async function AdminClientsPage() {
  if (!(await isStaff())) redirect("/admin/login?next=/admin/clients");

  const clients = await listClients();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-14">
      <Logo className="text-sm tracking-wide" />
      <h1 className="font-display mt-3 text-2xl font-semibold">Create or rotate a client&apos;s access code</h1>
      <p className="mt-1 text-sm text-text-dim">
        One shared login per client company. Send the code to them directly — over WhatsApp, e.g. —
        so they can sign in at /login.
      </p>

      <div className="mt-6">
        <ClientAccessCodeForm
          clients={clients.map((c) => ({ id: c.id, companyName: c.companyName }))}
        />
      </div>
    </main>
  );
}
