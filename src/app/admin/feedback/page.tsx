import { redirect } from "next/navigation";
import { Logo } from "@/app/Logo";
import { isStaff } from "@/lib/staffSession";
import { listAdminFeedback } from "@/lib/queries";
import { AdminFeedbackForm } from "./AdminFeedbackForm";

export const dynamic = "force-dynamic";

/**
 * Internal staff feedback, collected for the CEO to review — the
 * counterpart to client NPS feedback (see /e/[slug]/feedback). Mirrors
 * fotofoto-ops's real feedback_requests + review-page shape (a DB
 * table + a gated list), not a VS Code file log — see schema.ts's
 * adminFeedback comment for why.
 */
export default async function AdminFeedbackPage() {
  if (!(await isStaff())) redirect("/admin/login?next=/admin/feedback");

  const notes = await listAdminFeedback();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-14">
      <Logo className="text-sm tracking-wide" />
      <h1 className="font-display mt-3 text-2xl font-semibold">CEO feedback log</h1>
      <p className="mt-1 text-sm text-text-dim">
        Notes from the team, newest first. Visible to anyone signed in as staff.
      </p>

      <div className="mt-6">
        <AdminFeedbackForm />
      </div>

      <div className="mt-8 flex flex-col gap-2.5">
        {notes.length === 0 ? (
          <p className="text-sm text-text-dim-2">No notes yet.</p>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="rounded-2xl border border-border bg-panel p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gold">{n.authorLabel}</span>
                <span className="text-[10.5px] text-text-dim-2">
                  {new Date(n.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-text">{n.text}</p>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
