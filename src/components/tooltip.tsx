"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Один тултип на всё приложение. До этого их было три вида: нативный `title=`,
 * самодельная плашка на `group-hover` (обрезалась родительской панелью и
 * уезжала за правый край) и проброс `onHint` наверх. Здесь всё сразу:
 *
 * - рендер в портал, поэтому панель с `overflow: hidden` его не режет;
 * - позиция считается по месту — у правого края уходит влево, у верхнего вниз;
 * - тач: показываем по долгому нажатию, гасим по следующему касанию;
 * - клавиатура: появляется на фокусе, гаснет по Esc.
 */

const MARGIN = 8;
const TOUCH_HOLD_MS = 400;

export function Tooltip({
  label,
  children,
  placement = "top",
  className = "",
}: {
  /** Текст подсказки. Пустой — оболочка ничего не добавляет. */
  label?: ReactNode;
  children: ReactNode;
  placement?: "top" | "bottom";
  /** Классы оболочки: она inline-flex, чтобы не ломать поток. */
  className?: string;
}) {
  const id = useId();
  const hostRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const host = hostRef.current;
    const bubble = bubbleRef.current;
    if (!host || !bubble) return;
    const anchor = host.getBoundingClientRect();
    const box = bubble.getBoundingClientRect();
    const above = placement === "top" && anchor.top - box.height - MARGIN >= 0;
    const top = above
      ? anchor.top - box.height - 4
      : Math.min(anchor.bottom + 4, window.innerHeight - box.height - MARGIN);
    const left = Math.min(
      Math.max(MARGIN, anchor.left + anchor.width / 2 - box.width / 2),
      window.innerWidth - box.width - MARGIN,
    );
    setPos({ top, left });
  }, [placement]);

  // Первый кадр пузырь невидим: без замера его не поставить по месту.
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    const onScroll = () => setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(
    () => () => {
      if (holdRef.current) window.clearTimeout(holdRef.current);
    },
    [],
  );

  if (!label) {
    return (
      <span ref={hostRef} className={`inline-flex ${className}`}>
        {children}
      </span>
    );
  }

  return (
    <span
      ref={hostRef}
      className={`inline-flex ${className}`}
      aria-describedby={open ? id : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType === "touch") return;
        setOpen(true);
      }}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") return;
        // Долгое нажатие вместо наведения: на тач-экране hover не существует,
        // а обычный тап должен остаться нажатием на саму кнопку.
        holdRef.current = window.setTimeout(
          () => setOpen(true),
          TOUCH_HOLD_MS,
        );
      }}
      onPointerUp={(event) => {
        if (event.pointerType !== "touch") return;
        if (holdRef.current) window.clearTimeout(holdRef.current);
        window.setTimeout(() => setOpen(false), 1600);
      }}
      onPointerCancel={() => {
        if (holdRef.current) window.clearTimeout(holdRef.current);
        setOpen(false);
      }}
    >
      {children}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={bubbleRef}
              id={id}
              role="tooltip"
              data-tooltip=""
              className="pointer-events-none fixed z-[100] max-w-[min(20rem,calc(100vw-1rem))] rounded bg-slate-900 px-2 py-1 pto-t-sm leading-snug text-white shadow-lg"
              style={{
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                visibility: pos ? "visible" : "hidden",
              }}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
