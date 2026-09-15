"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Tier = "full_access" | "select";

type PhotoItem = {
  id: string;
  previewUrl: string;
  downloadUrl: string;
  orientation: "portrait" | "landscape" | "square" | null;
  uploadedAt: string | null;
};

type VideoItem = {
  id: string;
  thumbnailUrl: string;
  reviewUrl: string;
  orientation: "portrait" | "landscape" | "square" | null;
};

type SelectionState = {
  finalized: boolean;
  selectedPhotoIds: string[];
};

export type DeliverableGalleryState = {
  id: string;
  name: string;
  tier: Tier;
  quota: number;
  extraUnitNote: string | null;
  status: string;
  photos: PhotoItem[];
  videos: VideoItem[];
  selection: SelectionState | null;
};

const ratioFor = (orientation: PhotoItem["orientation"]) => {
  switch (orientation) {
    case "portrait":
      return "3 / 4";
    case "landscape":
      return "4 / 3";
    default:
      return "1 / 1";
  }
};

/**
 * One deliverable's gallery — quota/selection UI, masonry grid, video
 * strip, and lightbox. Extracted out of what used to be the whole of
 * Gallery.tsx (one gallery = one event) so Gallery.tsx can render one
 * of these per deliverable, tabbed when an event has more than one.
 * Reads its data from the `deliverable` prop (owned by Gallery.tsx's
 * poll of GET .../gallery) rather than fetching its own — only the
 * mutation calls (toggle/finalize) live here, each scoped to this
 * deliverable's id, calling `onChanged` afterward so the parent's next
 * poll (or an immediate one) picks up the new state.
 */
export function DeliverableGallerySection({
  slug,
  deliverable,
  onChanged,
}: {
  slug: string;
  deliverable: DeliverableGalleryState;
  onChanged: () => Promise<void>;
}) {
  const { photos, videos, selection } = deliverable;

  // Same rationale as the old Gallery.tsx: a Set, not a single id, so
  // multiple quick taps can each have their own in-flight request.
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const lightboxIndex = lightboxId ? photos.findIndex((p) => p.id === lightboxId) : -1;
  const lightboxPhoto = lightboxIndex >= 0 ? photos[lightboxIndex] : null;

  useEffect(() => {
    if (!lightboxPhoto) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [lightboxPhoto]);

  function showNext() {
    if (photos.length === 0 || lightboxIndex === -1) return;
    setLightboxId(photos[(lightboxIndex + 1) % photos.length].id);
  }
  function showPrev() {
    if (photos.length === 0 || lightboxIndex === -1) return;
    setLightboxId(photos[(lightboxIndex - 1 + photos.length) % photos.length].id);
  }

  useEffect(() => {
    if (!lightboxPhoto) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxId(null);
      else if (e.key === "ArrowRight") showNext();
      else if (e.key === "ArrowLeft") showPrev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxPhoto, lightboxIndex, photos]);

  const isSelectTier = deliverable.tier === "select";
  const selectedCount = selection?.selectedPhotoIds.length ?? 0;
  const hasExtra = selectedCount > deliverable.quota;
  const extraCount = Math.max(0, selectedCount - deliverable.quota);
  const pct = Math.min(100, Math.round((selectedCount / Math.max(1, deliverable.quota)) * 100));
  const finalized = selection?.finalized ?? false;

  async function toggle(photoId: string) {
    if (finalized || busyIds.has(photoId)) return;
    setBusyIds((prev) => new Set(prev).add(photoId));
    setError(null);
    try {
      const res = await fetch(`/api/events/${slug}/deliverables/${deliverable.id}/selection/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update selection");
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
    }
  }

  async function finalize() {
    setFinalizing(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${slug}/deliverables/${deliverable.id}/selection/finalize`, {
        method: "POST",
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not finalize");
      await onChanged();
      window.location.href = `/e/${slug}/finalize/${deliverable.id}`;
    } catch (err) {
      setError((err as Error).message);
      setFinalizing(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3 px-5 pb-2 pt-2">
        <div className="flex items-center justify-between">
          {isSelectTier ? (
            <span className="rounded-full bg-gold-soft px-3 py-1 text-xs font-bold tracking-wide text-gold">
              SELECT &amp; CHOOSE
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-panel px-3 py-1">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-gold" />
              <span className="text-xs font-bold tracking-wide text-gold">LIVE</span>
            </span>
          )}
        </div>
        <p className="text-sm text-text-dim">
          {isSelectTier
            ? "Tap photos to choose your favorites"
            : `Full access · ${photos.length} photo${photos.length === 1 ? "" : "s"} and counting`}
        </p>

        {isSelectTier && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-sm font-bold">
                {selectedCount} / {deliverable.quota} selected
              </span>
              {hasExtra && <span className="text-xs font-bold text-gold">+{extraCount} extra</span>}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${pct}%` }} />
            </div>
            {hasExtra && <p className="text-xs text-text-dim">{deliverable.extraUnitNote}</p>}
            {finalized && (
              <p className="text-xs font-semibold text-success">
                Selection finalized — downloads unlocked below.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Draft videos — kept separate from the photo grid, not part of
          select-tier quota/selection at all. */}
      {videos.length > 0 && (
        <div className="flex flex-col gap-2.5 px-5 pt-4">
          <div className="text-xs font-bold uppercase tracking-wide text-text-dim">Draft videos</div>
          <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {videos.map((v) => (
              <Link
                key={v.id}
                href={v.reviewUrl}
                className="relative h-28 w-44 flex-shrink-0 overflow-hidden rounded-xl bg-panel-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={v.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
                      <path d="M8 5v14l11-7Z" />
                    </svg>
                  </span>
                </div>
                <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-text">
                  VIDEO
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="masonry flex-1 px-5 py-4">
        {photos.length === 0 && (
          <p className="col-span-full py-10 text-center text-sm text-text-dim-2">
            No photos yet — they&apos;ll appear here the moment the photographer uploads.
          </p>
        )}
        {photos.map((p) => {
          const isSelected = selection?.selectedPhotoIds.includes(p.id) ?? false;
          const canDownloadThis = !isSelectTier || (finalized && isSelected);

          return (
            <div
              key={p.id}
              className="masonry-item relative overflow-hidden rounded bg-panel"
              style={{ aspectRatio: ratioFor(p.orientation) }}
            >
              {isSelectTier ? (
                // A plain div (not <button>) here so the magnify button
                // below can be a real sibling <button> rather than
                // nested inside one — HTML forbids nesting interactive
                // controls, and a nested button used to make the
                // magnify tap silently do nothing in some browsers.
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onClick={() => toggle(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(p.id);
                    }
                  }}
                  className="block h-full w-full cursor-pointer"
                  style={{
                    outline: isSelected ? "3px solid #d68a3c" : "3px solid transparent",
                    outlineOffset: "-3px",
                    borderRadius: "6px",
                    opacity: finalized ? 0.85 : 1,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  {isSelected && (
                    <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gold">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#191308"
                        strokeWidth={3.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </span>
                  )}
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={p.previewUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxId(p.id);
                }}
                aria-label="View larger"
                title="View larger"
                className="absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-text hover:bg-black/65"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                  <path d="M11 8v6M8 11h6" />
                </svg>
              </button>

              {canDownloadThis && (
                <a
                  href={p.downloadUrl}
                  className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-text hover:bg-black/65"
                  title="Download full resolution"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v13" />
                    <path d="m7 11 5 5 5-5" />
                    <path d="M5 21h14" />
                  </svg>
                </a>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="px-5 pb-2 text-sm text-red-400">{error}</p>}

      {/* Bottom bar */}
      <div className="sticky bottom-0 flex flex-col gap-2 bg-gradient-to-t from-bg from-30% to-transparent px-5 pb-6 pt-4">
        {isSelectTier ? (
          finalized ? (
            <a
              href={`/api/events/${slug}/deliverables/${deliverable.id}/download-all`}
              className="flex items-center justify-center gap-2 rounded-md bg-gold px-4 py-3.5 text-center font-bold text-gold-ink hover:opacity-90"
            >
              Download my photos
            </a>
          ) : (
            <button
              onClick={finalize}
              disabled={finalizing || selectedCount === 0}
              className="rounded-md bg-gold px-4 py-3.5 font-bold text-gold-ink hover:opacity-90 disabled:opacity-50"
            >
              {finalizing ? "Finalizing…" : "Finalize Selection"}
            </button>
          )
        ) : (
          <a
            href={`/api/events/${slug}/deliverables/${deliverable.id}/download-all`}
            className="flex items-center justify-center gap-2 rounded-md bg-gold px-4 py-3.5 text-center font-bold text-gold-ink hover:opacity-90"
          >
            Download All &middot; {photos.length} photos
          </a>
        )}
        <p className="text-center text-xs text-text-dim-2">
          {isSelectTier
            ? finalized
              ? "Full resolution, no watermark."
              : "You can keep tapping to change your picks until you finalize."
            : "Full resolution · no watermark · tap any photo to download it alone"}
        </p>
      </div>

      {lightboxPhoto && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={() => setLightboxId(null)}>
          <div className="flex items-center justify-between px-4 py-4" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs font-bold text-text-dim">
              {lightboxIndex + 1} / {photos.length}
            </span>
            <button
              onClick={() => setLightboxId(null)}
              aria-label="Close"
              className="rounded-full p-2 text-text hover:bg-white/10"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="relative flex flex-1 items-center justify-center px-3" onClick={(e) => e.stopPropagation()}>
            {photos.length > 1 && (
              <button
                onClick={showPrev}
                aria-label="Previous photo"
                className="absolute left-1 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-text hover:bg-black/65 sm:left-3"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
            )}

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightboxPhoto.previewUrl} alt="" className="max-h-full max-w-full rounded-sm object-contain" />

            {isSelectTier &&
              (() => {
                const lightboxSelected = selection?.selectedPhotoIds.includes(lightboxPhoto.id) ?? false;
                return (
                  <button
                    onClick={() => toggle(lightboxPhoto.id)}
                    disabled={finalized || busyIds.has(lightboxPhoto.id)}
                    aria-label={lightboxSelected ? "Remove from selection" : "Select this photo"}
                    aria-pressed={lightboxSelected}
                    className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full transition-opacity disabled:opacity-50 sm:right-4 sm:top-4"
                    style={
                      lightboxSelected
                        ? { background: "#d68a3c" }
                        : { background: "rgba(0,0,0,0.5)", border: "2px solid rgba(255,255,255,0.65)" }
                    }
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={lightboxSelected ? "#191308" : "#fff"} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </button>
                );
              })()}

            {photos.length > 1 && (
              <button
                onClick={showNext}
                aria-label="Next photo"
                className="absolute right-1 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-text hover:bg-black/65 sm:right-3"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            )}

            {(!isSelectTier || (finalized && (selection?.selectedPhotoIds.includes(lightboxPhoto.id) ?? false))) && (
              <a
                href={lightboxPhoto.downloadUrl}
                aria-label="Download full resolution"
                title="Download full resolution"
                className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-text hover:bg-black/70 sm:bottom-4 sm:right-4"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v13" />
                  <path d="m7 11 5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
              </a>
            )}
          </div>

          <div className="flex items-center justify-center gap-3 p-5" onClick={(e) => e.stopPropagation()}>
            {isSelectTier && !finalized && (
              <p className="text-xs text-text-dim-2">Tap the circle in the corner to select this photo</p>
            )}
            <Link
              href={`/e/${slug}/photo/${lightboxPhoto.id}`}
              className="flex items-center gap-2 rounded-md border border-border px-5 py-3 font-bold text-text hover:border-gold"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.8 4.6c-1.6-1.6-4.2-1.6-5.8 0L12 7.6l-3-3c-1.6-1.6-4.2-1.6-5.8 0-1.6 1.6-1.6 4.2 0 5.8l8.8 8.8 8.8-8.8c1.6-1.6 1.6-4.2 0-5.8Z" />
              </svg>
              Notes &amp; reactions
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
