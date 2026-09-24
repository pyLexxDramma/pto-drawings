"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  IconChevronLeft,
  IconChevronRight,
  IconDots,
} from "@/components/tool-icons";
import { VERDICT_DOT, VERDICT_DOT_INNER } from "@/lib/review-colors";
import type { ReviewVerdict } from "@/types";

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
  /** emerald — «готово», всё остальное — обычный ход работы на accent. */
  tone?: "accent" | "emerald";
  className?: string;
}) {
  const bar = tone === "emerald" ? "bg-sem-ok" : "bg-accent";
  return (
    <div className={`pto-progress overflow-hidden rounded-full bg-white/80 ${className}`}>
      <div
        className={`pto-progress__bar h-full ${bar}`}
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          transition: "width 400ms linear",
        }}
      />
    </div>
  );
}

/**
 * Кружок разбора. «Частично верно» и «Обсудить» теперь одного цвета — их
 * различает форма: у «Обсудить» кружок с прорезью внутри.
 */
export function VerdictDot({
  verdict,
  className = "h-2 w-2",
}: {
  verdict: ReviewVerdict;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full ${className} ${VERDICT_DOT[verdict]}`}
      data-verdict={verdict}
      aria-hidden
    >
      {VERDICT_DOT_INNER[verdict] ? (
        <span className="block h-[40%] w-[40%] rounded-full bg-white" />
      ) : null}
    </span>
  );
}

type SegmentAccent = "critical" | "warn" | "info" | "neutral";

type SegmentOption<T extends string> = {
  id: T;
  label: ReactNode;
  title?: string;
  /** Цвет важности: не вместо подписи, а вместе с ней. */
  accent?: SegmentAccent;
};

const ACCENT_IDLE: Record<SegmentAccent, string> = {
  critical: "text-red-700 hover:bg-red-50 hover:text-red-800",
  warn: "text-amber-800 hover:bg-amber-50 hover:text-amber-900",
  info: "text-sky-700 hover:bg-sky-50 hover:text-sky-800",
  neutral: "",
};

const ACCENT_ACTIVE: Record<SegmentAccent, string> = {
  critical: "bg-red-600 text-white font-semibold shadow-sm",
  warn: "bg-amber-500 text-white font-semibold shadow-sm",
  info: "bg-sky-600 text-white font-semibold shadow-sm",
  neutral: "",
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
  /** onDark — уже внутри тёмной панели: своей подложки и рамки не рисуем. */
  tone?: "light" | "dark" | "onDark";
  className?: string;
}) {
  const pad = size === "xs" ? "px-2 py-0.5 pto-t-md" : "px-2.5 py-1 text-xs";
  const shell =
    tone === "dark"
      ? "border-[#3a4454] bg-[#12161c]"
      : tone === "onDark"
        ? "border-transparent"
        : "border-slate-300 bg-slate-100";
  const idle =
    tone === "light"
      ? "text-muted hover:bg-white hover:text-text"
      : "text-white/65 hover:bg-white/20 hover:text-white";
  const active =
    tone === "dark"
      ? "bg-[#2a3342] text-white shadow-sm ring-1 ring-sky-400/50"
      : tone === "onDark"
        ? "bg-white/20 font-semibold text-white ring-1 ring-white/30"
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
            className={`rounded font-medium transition-colors ${pad} ${
              selected
                ? option.accent && ACCENT_ACTIVE[option.accent]
                  ? ACCENT_ACTIVE[option.accent]
                  : active
                : option.accent && ACCENT_IDLE[option.accent]
                  ? ACCENT_IDLE[option.accent]
                  : idle
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
  open: openProp,
  onOpenChange,
  children,
}: {
  label?: string;
  align?: "left" | "right";
  triggerClassName?: string;
  trigger?: ReactNode;
  menuClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [openInternal, setOpenInternal] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openInternal;

  function setOpen(next: boolean) {
    if (!controlled) setOpenInternal(next);
    onOpenChange?.(next);
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = rootRef.current?.querySelector("button");
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const pad = 8;
    let left =
      align === "right" ? rect.right + 4 : rect.left;
    if (left + mw > window.innerWidth - pad) {
      left = rect.left - mw - 4;
    }
    left = Math.min(Math.max(pad, left), window.innerWidth - mw - pad);
    let top = rect.bottom + 4;
    if (top + mh > window.innerHeight - pad) {
      top = Math.max(pad, rect.top - mh - 4);
    }
    setPos({ top, left });
  }, [open, align, children]);

  useEffect(() => {
    if (!open) return;
    // click, не mousedown: иначе пункт меню размонтируется до click и onClick не срабатывает
    function onPointer(event: MouseEvent) {
      const node = event.target as Node;
      if (rootRef.current?.contains(node)) return;
      if (menuRef.current?.contains(node)) return;
      setOpen(false);
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
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
        className={
          triggerClassName ??
          "rounded border border-border px-1.5 py-0.5 pto-t-md leading-none text-muted hover:bg-bg hover:text-text"
        }
      >
        {trigger ?? (
          <span className="inline-flex items-center justify-center">
            <IconDots className="h-3.5 w-3.5" />
          </span>
        )}
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ top: pos.top, left: pos.left }}
              className={`fixed z-[80] min-w-[10rem] rounded-md border border-slate-300 bg-white py-1 shadow-md ${menuClassName}`}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div
                onClick={() => setOpen(false)}
                onKeyDown={() => setOpen(false)}
                role="none"
              >
                {children}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function menuItemClass(danger = false) {
  return `flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-xs hover:bg-bg ${
    danger ? "text-red-600" : "text-text"
  }`;
}

/** Свернуть / развернуть боковую панель — шеврон «внутрь» или «наружу». */
export function PaneToggle({
  expanded,
  expandLabel,
  collapseLabel,
  align = "left",
  onToggle,
  className = "",
}: {
  expanded: boolean;
  expandLabel: string;
  collapseLabel: string;
  align?: "left" | "right";
  onToggle: () => void;
  className?: string;
}) {
  const label = expanded ? collapseLabel : expandLabel;
  const inward = align === "left";
  const Icon =
    expanded === inward ? IconChevronLeft : IconChevronRight;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`relative z-20 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 ${className}`}
    >
      <Icon />
    </button>
  );
}
