"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Spinner({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <span
      className={`pto-spinner inline-block shrink-0 rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden
    />
  );
}

export function ProgressTrack({
  value,
  tone = "accent",
  className = "h-1.5",
}: {
  value: number;
  tone?: "accent" | "sky";
  className?: string;
}) {
  const bar =
    tone === "sky" ? "bg-sky-500" : "bg-accent";
  return (
    <div className={`pto-progress overflow-hidden rounded-full bg-white/80 ${className}`}>
      <div
        className={`pto-progress__bar h-full transition-all ${bar}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function ActionMenu({
  label = "Действия",
  align = "right",
  children,
}: {
  label?: string;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        title={label}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="rounded border border-border px-1.5 py-0.5 text-[11px] leading-none text-muted hover:bg-bg hover:text-text"
      >
        ⋯
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute z-30 mt-1 min-w-[10rem] rounded-md border border-border bg-white py-1 shadow-md ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div
            onClick={() => setOpen(false)}
            onKeyDown={() => setOpen(false)}
            role="none"
          >
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function menuItemClass(danger = false) {
  return `block w-full px-3 py-1.5 text-left text-xs hover:bg-bg ${
    danger ? "text-red-600" : "text-text"
  }`;
}
