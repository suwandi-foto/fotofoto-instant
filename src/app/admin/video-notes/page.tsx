import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/app/Logo";
import { isStaff } from "@/lib/staffSession";
import { listVideosWithPendingNotes } from "@/lib/queries";
import { MarkAddressedButton } from "./MarkAddressedButton";

export const dynamic = "force-dynamic";

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Cross-event triage view for Video Review's revision notes — without
 * this, a staff member has to open each event/video individually to
 * see what clients have flagged. Desktop-oriented (a wide table-ish
 * layout, not the mobile-first client screens elsewhere in this app),
 * staff-only.
 */
export default async function AdminVideoNotesPage() {
  if (!(await isStaff())) redirect("/admin/login?next=/admin/video-notes");

  const groups = await listVideosWithPendingNotes();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-14">
      <Logo className="text-sm tracking-wide" />
      <h1 className="font-display mt-3 text-2xl font-semibold">Pending video revision notes</h1>
      <p className="mt-1 text-sm text-text-dim">
        Every video with un-addressed client notes, across all events.
      </p>

      {groups.length === 0 ? (
        <p className="mt-8 text-sm text-text-dim-2">Nothing pending — every note has been addressed.</p>
      ) : (
        <div className="mt-8 flex flex-col gap-5">
          {groups.map(({ video, notes }) => (
            <div key={video.id} className="flex gap-4 rounded-2xl border border-border bg-panel p-4">
              <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-xl bg-panel-2">
                {video.thumbnailPath && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/photos/${video.id}/thumbnail`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-bold">{video.event.name}</div>
                  <Link
                    href={`/e/${video.event.slug}/video/${video.id}`}
                    target="_blank"
                    className="flex-shrink-0 text-xs font-bold text-gold hover:underline"
                  >
                    Open review →
                  </Link>
                </div>
                <div className="mt-2 flex flex-col gap-2">
                  {notes.map((n) => (
                    <div key={n.id} className="flex items-start justify-between gap-3 rounded-lg bg-panel-2 p-2.5">
                      <div className="min-w-0">
                        <div className="text-[11px] font-extrabold text-gold">
                          {formatTime(n.timestampSeconds)}
                        </div>
                        <div className="mt-0.5 text-xs text-text-dim">{n.note}</div>
                      </div>
                      <MarkAddressedButton noteId={n.id} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
