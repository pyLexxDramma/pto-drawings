"use client";

import { useCallback, useRef, type MouseEvent } from "react";

type ColumnResizerProps = {
  /** Called with delta X in px while dragging. */
  onDelta: (dx: number) => void;
  title?: string;
  className?: string;
};

/** Vertical Excel-like drag handle between columns. */
export function ColumnResizer({
  onDelta,
  title = "Потяните, чтобы изменить ширину",
  className = "",
}: ColumnResizerProps) {
  const lastX = useRef(0);

  const onMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      lastX.current = event.clientX;
      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const move = (moveEvent: globalThis.MouseEvent) => {
        const dx = moveEvent.clientX - lastX.current;
        lastX.current = moveEvent.clientX;
        if (dx !== 0) onDelta(dx);
      };
      const up = () => {
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [onDelta],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title={title}
      onMouseDown={onMouseDown}
      className={`group relative z-10 w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-accent active:bg-accent ${className}`}
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-400 opacity-0 group-hover:opacity-100" />
    </div>
  );
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
