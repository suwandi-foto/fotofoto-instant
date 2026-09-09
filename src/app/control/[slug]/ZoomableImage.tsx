"use client";

import { useRef, useState } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 5;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function distance(a: React.Touch, b: React.Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * A thumbnail that opens into a full-screen scroll-to-zoom /
 * pinch-to-zoom / drag-to-pan viewer — for the preset tester, where a
 * photographer needs to check fine detail (skin tones, sharpness,
 * color banding) that a small fixed square can't show. Deliberately
 * dependency-free (plain CSS transform driven by wheel/touch/drag
 * state) rather than pulling in an image-viewer library for one
 * component.
 */
export function ZoomableImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; startPos: { x: number; y: number } } | null>(null);
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null);

  function reset() {
    setScale(1);
    setPos({ x: 0, y: 0 });
  }

  function onClose() {
    setOpen(false);
    reset();
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setScale((prev) => clamp(prev - e.deltaY * 0.01, MIN_SCALE, MAX_SCALE));
  }

  function onMouseDown(e: React.MouseEvent) {
    if (scale <= 1) return;
    dragRef.current = { x: e.clientX, y: e.clientY, startPos: pos };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setPos({ x: dragRef.current.startPos.x + dx, y: dragRef.current.startPos.y + dy });
  }
  function onMouseUp() {
    dragRef.current = null;
  }

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      pinchRef.current = { startDist: distance(e.touches[0], e.touches[1]), startScale: scale };
    } else if (e.touches.length === 1 && scale > 1) {
      dragRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, startPos: pos };
    }
  }
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchRef.current) {
      const d = distance(e.touches[0], e.touches[1]);
      const next = clamp((d / pinchRef.current.startDist) * pinchRef.current.startScale, MIN_SCALE, MAX_SCALE);
      setScale(next);
    } else if (e.touches.length === 1 && dragRef.current) {
      const dx = e.touches[0].clientX - dragRef.current.x;
      const dy = e.touches[0].clientY - dragRef.current.y;
      setPos({ x: dragRef.current.startPos.x + dx, y: dragRef.current.startPos.y + dy });
    }
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0) dragRef.current = null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full cursor-zoom-in"
        aria-label={`Zoom in on ${alt || "preview"}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={className} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
          onClick={onClose}
          onWheel={onWheel}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="flex items-center justify-between p-4" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs font-bold text-text-dim">Scroll or pinch to zoom · drag to pan</span>
            <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-text hover:bg-white/10">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div
            className="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-4"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
            style={{ cursor: scale > 1 ? "grab" : "default" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              draggable={false}
              className="max-h-full max-w-full select-none rounded-sm object-contain"
              style={{
                transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
                transition: dragRef.current || pinchRef.current ? "none" : "transform 0.05s linear",
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
