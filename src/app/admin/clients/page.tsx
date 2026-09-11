import { redirect } from "next/navigation";
import { Logo } from "@/app/Logo";
import { isStaff } from "@/lib/staffSession";
import { listClients } from "@/lib/queries";
import { NewClientContactForm } from "./NewClientContactForm";

export const dynamic = "force-dynamic";

/**
 * Staff-facing replacement for the dev-only POST /api/dev/contacts
 * seeding route — the real way to create a client contact and get
 * their login access code, working the same in production as in dev
 * (staff-gated, not NODE_ENV-gated). See POST /api/admin/clients.
 */
export default async function AdminClientsPage() {
  if (!(await isStaff())) redirect("/admin/login?next=/admin/clients");

  const clients = await listClients();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-14">
      <Logo className="text-sm tracking-wide" />
      <h1 className="font-display mt-3 text-2xl font-semibold">Add a client contact</h1>
      <p className="mt-1 text-sm text-text-dim">
        Creates the login and shows the access code to send the client — over WhatsApp, e.g. — so
        they can sign in at /login.
      </p>

      <div className="mt-6">
        <NewClientContactForm
          clients={clients.map((c) => ({ id: c.id, companyName: c.companyName }))}
        />
      </div>
    </main>
  );
}
