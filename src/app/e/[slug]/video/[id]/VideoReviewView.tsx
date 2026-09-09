"use client";

import { useRef, useState } from "react";
import Link from "next/link";

type Note = { id: string; timestampSeconds: number; note: string; author: string };
type Status = "awaiting_notes" | "revision_requested" | "approved";

function formatTime(totalSeconds: number) {
  const safe = Number.isFinite(totalSeconds) && totalSeconds >= 0 ? totalSeconds : 0;
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const STATUS_LABEL: Record<Status, string> = {
  awaiting_notes: "AWAITING NOTES",
  revision_requested: "REVISION REQUESTED",
  approved: "APPROVED",
};

export function VideoReviewView({
  eventSlug,
  eventName,
  videoId,
  previewUrl,
  initialNotes,
  initialStatus,
  initialDecidedByName,
}: {
  eventSlug: string;
  eventName: string;
  videoId: string;
  previewUrl: string;
  initialNotes: Note[];
  initialStatus: Status;
  initialDecidedByName: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const [notes, setNotes] = useState(initialNotes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoError, setVideoError] = useState(false);
  const [addingNote, setAddingNote] = useState(false);

  const [status, setStatus] = useState<Status>(initialStatus);
  const [decidedByName, setDecidedByName] = useState(initialDecidedByName);
  const [deciding, setDeciding] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // No real duration is available until a real video file loads (see
  // the pipeline note on the page component) — fall back to a scale
  // that still places marks sensibly relative to each other.
  const effectiveDuration =
    duration > 0 ? duration : Math.max(60, currentTime, ...notes.map((n) => n.timestampSeconds));

  async function refreshNotes() {
    const res = await fetch(`/api/videos/${videoId}/notes`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setNotes(data.notes);
    }
  }

  function seekTo(id: string, timestampSeconds: number) {
    setSelectedId(id);
    if (videoRef.current) {
      videoRef.current.currentTime = timestampSeconds;
    }
    setCurrentTime(timestampSeconds);
  }

  async function handleAddNote() {
    if (addingNote) return;
    const time = videoRef.current?.currentTime ?? currentTime;
    const note = window.prompt(`Add a note at ${formatTime(time)}:`);
    if (!note || !note.trim()) return;

    setAddingNote(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timestampSeconds: time, note: note.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not add note");
      await refreshNotes();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAddingNote(false);
    }
  }

  async function decide(decision: "approve" | "revise") {
    if (deciding || status !== "awaiting_notes") return;
    setDeciding(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not record decision");
      const data = await res.json();
      setStatus(data.review.status);
      setDecidedByName(data.review.decidedByName);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeciding(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-5">
        <Link href={`/e/${eventSlug}`} aria-label="Back to gallery" className="text-text-dim hover:text-text">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <div className="flex-grow">
          <div className="font-display text-[16.5px] font-bold">{eventName}</div>
          <div className="mt-0.5 text-[11.5px] font-semibold text-text-dim">Video draft review</div>
        </div>
        <span
          className={`flex-shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${
            status === "approved"
              ? "border-success/30 bg-success/10 text-success"
              : "border-gold/35 bg-gold/10 text-gold"
          }`}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className="px-5">
        <div className="relative w-full overflow-hidden rounded-2xl bg-panel-2" style={{ aspectRatio: "16 / 9" }}>
          {!videoError ? (
            <video
              ref={videoRef}
              src={previewUrl}
              controls
              className="h-full w-full"
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
              onError={() => setVideoError(true)}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-panel-2 to-black">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gold/90">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#000000">
                  <path d="M8 5v14l11-7Z" />
                </svg>
              </div>
              <span className="absolute left-2.5 top-2.5 rounded-md bg-black/60 px-2 py-1 text-[9.5px] font-extrabold">
                LOW-RES · WATERMARKED PREVIEW
              </span>
              <p className="absolute bottom-2.5 px-4 text-center text-[10.5px] text-text-dim">
                Preview not available yet — the video pipeline hasn&apos;t been built. Notes and
                decisions below are fully real.
              </p>
            </div>
          )}
        </div>

        <div className="relative mt-3 h-[30px]">
          <div className="absolute left-0 right-0 top-3 h-1 rounded-full bg-border" />
          <div
            className="absolute left-0 top-3 h-1 rounded-full bg-gold"
            style={{ width: `${Math.min(100, (currentTime / effectiveDuration) * 100)}%` }}
          />
          {notes.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => seekTo(n.id, n.timestampSeconds)}
              style={{ left: `${Math.min(100, (n.timestampSeconds / effectiveDuration) * 100)}%` }}
              aria-label={`Jump to note at ${formatTime(n.timestampSeconds)}`}
              className={`absolute top-1 h-[18px] w-[18px] -translate-x-1/2 rounded-full border-2 border-black ${
                selectedId === n.id ? "bg-text" : "bg-gold"
              }`}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10.5px] text-text-dim-2">
          <span>0:00</span>
          <span>{formatTime(effectiveDuration)}</span>
        </div>
      </div>

      <div className="px-5 pt-4">
        <button
          type="button"
          onClick={handleAddNote}
          disabled={addingNote}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-border px-3 py-3 text-xs font-bold text-text-dim hover:border-gold disabled:opacity-60"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {addingNote ? "Adding…" : `Add a note at ${formatTime(currentTime)}`}
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-2.5 px-5">
        <div className="text-[11px] font-extrabold uppercase tracking-wide text-text-dim-2">Revision notes</div>
        {notes.length === 0 ? (
          <p className="text-sm text-text-dim-2">No notes yet — scrub to a moment and add one.</p>
        ) : (
          notes.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => seekTo(n.id, n.timestampSeconds)}
              className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-left ${
                selectedId === n.id ? "border-gold bg-gold/10" : "border-border bg-panel"
              }`}
            >
              <div className="w-9 flex-shrink-0 text-[11px] font-extrabold text-gold">
                {formatTime(n.timestampSeconds)}
              </div>
              <div>
                <div className="text-xs font-bold">{n.author}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-text-dim">{n.note}</div>
              </div>
            </button>
          ))
        )}
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-2.5 border-t border-border px-5 pb-8 pt-4">
        {error && <p className="text-xs text-red-400">{error}</p>}
        {status !== "awaiting_notes" ? (
          <div
            className={`rounded-xl border p-3.5 text-xs font-bold ${
              status === "approved"
                ? "border-success/30 bg-success/10 text-success"
                : "border-gold/35 bg-gold/10 text-gold"
            }`}
          >
            {status === "approved"
              ? `Approved${decidedByName ? ` by ${decidedByName}` : ""} — full-resolution video will be delivered shortly.`
              : `Sent back for revision${decidedByName ? ` by ${decidedByName}` : ""} — Creatives will address these notes.`}
          </div>
        ) : (
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => decide("revise")}
              disabled={deciding}
              className="flex-grow rounded-xl bg-gold px-4 py-3.5 text-xs font-extrabold text-gold-ink hover:opacity-90 disabled:opacity-60"
            >
              Request Revisions
            </button>
            <button
              type="button"
              onClick={() => decide("approve")}
              disabled={deciding}
              className="flex-grow rounded-xl border-[1.5px] border-border px-4 py-3.5 text-xs font-extrabold text-text hover:border-gold disabled:opacity-60"
            >
              Approve Final Cut
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
