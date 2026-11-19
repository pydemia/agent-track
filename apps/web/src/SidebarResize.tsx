import { useEffect, useRef } from "react";

const clamp = (width: number) => Math.max(180, Math.min(360, Math.round(width)));

/** An invisible boundary, with Note's preview/commit and keyboard behavior. */
export function SidebarResize({ width, displayWidth, onPreview, onChange }: {
  width: number; displayWidth: number;
  onPreview: (width: number | null) => void; onChange: (width: number) => void;
}) {
  const edge = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; start: number; next: number } | null>(null);
  const cancel = () => {
    const current = drag.current; drag.current = null; onPreview(null);
    if (current && edge.current?.hasPointerCapture(current.pointer)) edge.current.releasePointerCapture(current.pointer);
  };
  useEffect(() => {
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("blur", cancel); cancel(); };
  }, [onPreview]);
  useEffect(() => { cancel(); }, [width]);
  return <div ref={edge} className="sidebar-edge" role="separator" tabIndex={0}
    aria-label="사이드바 너비 조절" aria-controls="context-sidebar" aria-orientation="vertical"
    aria-valuemin={180} aria-valuemax={360} aria-valuenow={displayWidth} aria-valuetext={`${displayWidth}px`}
    title="경계를 끌어 너비 조절 · 방향키 16px · 두 번 클릭해 기본 너비"
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      drag.current = { pointer: event.pointerId, x: event.clientX, start: width, next: width };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      current.next = clamp(current.start + event.clientX - current.x); onPreview(current.next);
    }}
    onPointerUp={event => {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      drag.current = null; onPreview(null);
      event.currentTarget.releasePointerCapture(event.pointerId);
      onChange(clamp(current.start + event.clientX - current.x));
    }} onPointerCancel={cancel} onLostPointerCapture={cancel}
    onDoubleClick={() => { cancel(); onChange(240); }}
    onKeyDown={event => {
      if (event.key === "Escape" && drag.current) { event.preventDefault(); cancel(); return; }
      const step = event.shiftKey ? 64 : 16;
      const next = event.key === "Home" ? 180 : event.key === "End" ? 360
        : event.key === "ArrowLeft" ? clamp(width - step) : event.key === "ArrowRight" ? clamp(width + step) : null;
      if (next !== null) { event.preventDefault(); cancel(); onChange(next); }
    }} />;
}
