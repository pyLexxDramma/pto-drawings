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

type SegmentOption<T extends string> = {
  id: T;
  label: ReactNode;
  title?: string;
};

/** Единый вид табов: сегмент с явным активным состоянием. */
export function SegmentedTabs<T extends string>({
  value,
  options,
  onChange,
  size = "sm",
  tone = "light",
  className = "",
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (id: T) => void;
  size?: "sm" | "xs";
  tone?: "light" | "dark";
  className?: string;
}) {
  const pad = size === "xs" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";
  const shell =
    tone === "dark"
      ? "border-[#3a4454] bg-[#12161c]"
      : "border-slate-300 bg-slate-100";
  const idle =
    tone === "dark"
      ? "text-[#8b93a3] hover:bg-[#252b36] hover:text-[#e8eaef]"
      : "text-muted hover:bg-white hover:text-text";
  const active =
    tone === "dark"
      ? "bg-[#2a3342] text-white shadow-sm ring-1 ring-sky-400/50"
      : "bg-white text-text font-semibold shadow-sm ring-1 ring-accent/50";

  return (
    <div
      role="tablist"
      className={`inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-md border p-0.5 ${shell} ${className}`}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            title={option.title}
            onClick={() => onChange(option.id)}
            className={`rounded-[5px] font-medium transition-colors ${pad} ${
              selected ? active : idle
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function ActionMenu({
  label = "Действия",
  align = "right",
  triggerClassName,
  /** Своё содержимое кнопки вместо «⋯» — например номер листа. */
  trigger,
  menuClassName = "",
  children,
}: {
  label?: string;
  align?: "left" | "right";
  triggerClassName?: string;
  trigger?: ReactNode;
  menuClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // click, не mousedown: иначе пункт меню размонтируется до click и onClick не срабатывает
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("click", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onPointer);
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
        className={
          triggerClassName ??
          "rounded border border-border px-1.5 py-0.5 text-[11px] leading-none text-muted hover:bg-bg hover:text-text"
        }
      >
        {trigger ?? "⋯"}
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute z-40 mt-1 min-w-[11rem] rounded-md border border-slate-300 bg-white py-1 shadow-md ${
            align === "right" ? "right-0" : "left-0"
          } ${menuClassName}`}
          onMouseDown={(event) => event.stopPropagation()}
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
  return `flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-xs hover:bg-bg ${
    danger ? "text-red-600" : "text-text"
  }`;
}
