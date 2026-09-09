"use client";

import { useState } from "react";
import Link from "next/link";

type Annotation = {
  id: string;
  number: number;
  xPct: number;
  yPct: number;
  note: string;
  author: string;
};

export function PhotoDetailView({
  eventSlug,
  eventName,
  photoId,
  previewUrl,
  position,
  total,
  initialAnnotations,
  initialLiked,
  initialLikeCount,
}: {
  eventSlug: string;
  eventName: string;
  photoId: string;
  previewUrl: string;
  position: number;
  total: number;
  initialAnnotations: Annotation[];
  initialLiked: boolean;
  initialLikeCount: number;
}) {
  const [annotations, setAnnotations] = useState(initialAnnotations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingPin, setAddingPin] = useState(false);
  const [liked, setLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [togglingLike, setTogglingLike] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshAnnotations() {
    const res = await fetch(`/api/photos/${photoId}/annotations`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setAnnotations(data.annotations);
    }
  }

  async function handleImageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (addingPin) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;

    const note = window.prompt("Add a note for this spot on the photo:");
    if (!note || !note.trim()) return;

    setAddingPin(true);
    setError(null);
    try {
      const res = await fetch(`/api/photos/${photoId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xPct, yPct, note: note.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not add note");
      await refreshAnnotations();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAddingPin(false);
    }
  }

  async function toggleLike() {
    if (togglingLike) return;
    setTogglingLike(true);
    setError(null);
    try {
      const res = await fetch(`/api/photos/${photoId}/reactions/toggle`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update reaction");
      const data = await res.json();
      setLiked(data.liked);
      setLikeCount(data.count);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTogglingLike(false);
    }
  }

  async function handleShare() {
    setShareMessage(null);
    try {
      const res = await fetch(previewUrl);
      const blob = await res.blob();
      const file = new File([blob], `fotofoto-${photoId}.webp`, { type: blob.type || "image/webp" });
      const canShareFiles =
        typeof navigator !== "undefined" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] });
      if (canShareFiles) {
        await navigator.share({ files: [file], title: "FOTOFOTO", text: `Framed with FOTOFOTO · ${eventName}` });
        return;
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return; // user closed the native share sheet
    }

    // Fallback where the Web Share API (or file sharing specifically)
    // isn't supported — there's no real Instagram Stories API a web
    // app can call, so this downloads the photo for a manual share
    // instead of pretending to post it directly.
    const a = document.createElement("a");
    a.href = previewUrl;
    a.download = `fotofoto-${photoId}.webp`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setShareMessage(
      "Direct sharing isn't available in this browser — downloaded the photo instead so you can share it to your Story manually."
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
      <div className="flex items-center gap-2.5 px-5 pb-3.5 pt-5">
        <Link href={`/e/${eventSlug}`} aria-label="Back to gallery" className="text-text-dim hover:text-text">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <div>
          <div className="font-display text-[15.5px] font-bold">{eventName}</div>
          <div className="mt-0.5 text-[11px] text-text-dim">
            Photo {position} of {total} · tap a pin to read its note
          </div>
        </div>
      </div>

      <div className="px-5">
        <div
          className="relative w-full cursor-crosshair overflow-hidden rounded-2xl bg-panel-2"
          onClick={handleImageClick}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="" className="block w-full select-none" draggable={false} />

          {annotations.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedId(a.id);
              }}
              style={{ top: `${a.yPct}%`, left: `${a.xPct}%` }}
              aria-label={`Pin ${a.number}: ${a.note}`}
              className={`absolute flex h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-black text-[11px] font-extrabold ${
                selectedId === a.id ? "bg-text text-black" : "bg-gold text-gold-ink"
              }`}
            >
              {a.number}
            </button>
          ))}
        </div>
        {addingPin && <p className="mt-2 text-xs text-text-dim-2">Adding your note…</p>}
      </div>

      <div className="mt-3 flex items-center gap-3 px-5">
        <button
          type="button"
          onClick={toggleLike}
          disabled={togglingLike}
          aria-pressed={liked}
          className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 disabled:opacity-60 ${
            liked ? "border-[#e0607a] bg-[#e0607a]/10" : "border-border bg-transparent"
          }`}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill={liked ? "#e0607a" : "none"}
            stroke={liked ? "#e0607a" : "currentColor"}
            strokeWidth={2.3}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.8 4.6c-1.6-1.6-4.2-1.6-5.8 0L12 7.6l-3-3c-1.6-1.6-4.2-1.6-5.8 0-1.6 1.6-1.6 4.2 0 5.8l8.8 8.8 8.8-8.8c1.6-1.6 1.6-4.2 0-5.8Z" />
          </svg>
          <span className="text-xs font-extrabold">{likeCount}</span>
        </button>

        <button
          type="button"
          onClick={handleShare}
          className="flex flex-grow items-center justify-center gap-2 rounded-full border border-border bg-panel px-3.5 py-2.5 hover:border-gold"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <circle cx="12" cy="12" r="3.5" />
            <circle cx="17" cy="7" r="1" />
          </svg>
          <span className="text-xs font-extrabold">Share to Instagram Story</span>
        </button>
      </div>

      {shareMessage && <p className="mt-2 px-5 text-xs text-text-dim">{shareMessage}</p>}
      {error && <p className="mt-2 px-5 text-xs text-red-400">{error}</p>}

      <div className="mt-6 flex flex-col gap-2.5 px-5 pb-10">
        <div className="text-[11px] font-extrabold uppercase tracking-wide text-text-dim-2">
          Notes on this photo
        </div>
        {annotations.length === 0 ? (
          <p className="text-sm text-text-dim-2">No notes yet — tap anywhere on the photo to add one.</p>
        ) : (
          annotations.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelectedId(a.id)}
              className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-left ${
                selectedId === a.id ? "border-gold bg-gold/10" : "border-border bg-panel"
              }`}
            >
              <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-gold text-[10.5px] font-extrabold text-gold-ink">
                {a.number}
              </div>
              <div>
                <div className="text-xs font-bold">{a.author}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-text-dim">{a.note}</div>
              </div>
            </button>
          ))
        )}
      </div>
    </main>
  );
}
