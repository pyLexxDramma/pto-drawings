"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconExpand,
  IconMinus,
  IconPlus,
} from "@/components/tool-icons";
import type { FitMode } from "@/hooks/use-page-viewport";

const PERCENTS = [50, 100, 200, 400];

/**
 * Листы и масштаб — в нижней полосе, как в обычном просмотрщике.
 * Верхняя панель остаётся под PDF/DWG и «весь экран».
 */
export function ViewerSheetControls({
  scale,
  fitMode,
  onFit,
  onZoomBy,
  onSetPercent,
  onPrevPage,
  onNextPage,
  canPrevPage = false,
  canNextPage = false,
  hasLegible = false,
  menuUp = false,
}: {
  scale: number;
  fitMode: FitMode;
  onFit: (mode: FitMode) => void;
  onZoomBy: (factor: number) => void;
  onSetPercent: (percent: number) => void;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  canPrevPage?: boolean;
  canNextPage?: boolean;
  hasLegible?: boolean;
  /** Меню масштаба открывается вверх — контролы стоят у нижнего края. */
  menuUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      onMouseDown={(event) => event.stopPropagation()}
      className="inline-flex items-center gap-0.5 text-text"
      data-viewer-nav=""
    >
      {onPrevPage || onNextPage ? (
        <div className="flex items-center overflow-hidden rounded border border-border bg-white">
          <button
            type="button"
            title="Предыдущий лист (K / PageUp)"
            aria-label="Предыдущий лист"
            onClick={() => onPrevPage?.()}
            disabled={!canPrevPage}
            className="pto-tool pto-tool--slim inline-flex w-6 items-center justify-center hover:bg-black/5 disabled:cursor-default disabled:opacity-40"
          >
            <IconChevronLeft className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="Следующий лист (J / PageDown / пробел)"
            aria-label="Следующий лист"
            onClick={() => onNextPage?.()}
            disabled={!canNextPage}
            className="pto-tool pto-tool--slim inline-flex w-6 items-center justify-center border-l border-border hover:bg-black/5 disabled:cursor-default disabled:opacity-40"
          >
            <IconChevronRight className="h-3 w-3" />
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title="Отдалить"
          aria-label="Отдалить"
          onClick={() => onZoomBy(1 / 1.25)}
          className="pto-tool pto-tool--slim flex w-6 items-center justify-center rounded hover:bg-black/5"
        >
          <IconMinus className="h-3 w-3" />
        </button>
        <div className="relative">
          <button
            type="button"
            title="Масштаб — выбрать или вписать лист"
            aria-expanded={open}
            aria-haspopup="listbox"
            onClick={() => setOpen((value) => !value)}
            className="pto-tool pto-tool--slim min-w-[2.5rem] rounded px-0.5 text-center pto-t-md font-medium tabular-nums hover:bg-black/5"
            data-viewer-scale=""
          >
            {Math.round(scale * 100)}%
          </button>
          {open ? (
            <div
              role="listbox"
              className={`absolute right-0 z-40 min-w-[8.5rem] rounded-md border border-border bg-white py-1 text-xs text-text shadow-md ${
                menuUp ? "bottom-full mb-1" : "top-full mt-1"
              }`}
            >
              <button
                type="button"
                role="option"
                aria-selected={fitMode === "page"}
                onClick={() => {
                  onFit("page");
                  setOpen(false);
                }}
                className="flex w-full px-3 py-1.5 text-left hover:bg-bg"
              >
                По странице
              </button>
              <button
                type="button"
                role="option"
                aria-selected={fitMode === "width"}
                onClick={() => {
                  onFit("width");
                  setOpen(false);
                }}
                className="flex w-full px-3 py-1.5 text-left hover:bg-bg"
              >
                По ширине
              </button>
              {hasLegible ? (
                <button
                  type="button"
                  role="option"
                  aria-selected={fitMode === "legible"}
                  title="Масштаб, при котором читаются подписи на листе"
                  onClick={() => {
                    onFit("legible");
                    setOpen(false);
                  }}
                  className="flex w-full px-3 py-1.5 text-left hover:bg-bg"
                  data-viewer-legible=""
                >
                  Читаемо
                </button>
              ) : null}
              <div className="my-1 border-t border-border" />
              {PERCENTS.map((percent) => (
                <button
                  key={percent}
                  type="button"
                  role="option"
                  onClick={() => {
                    onSetPercent(percent);
                    setOpen(false);
                  }}
                  className="flex w-full px-3 py-1.5 text-left tabular-nums hover:bg-bg"
                  aria-selected={false}
                >
                  {percent}%
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          title="Приблизить"
          aria-label="Приблизить"
          onClick={() => onZoomBy(1.25)}
          className="pto-tool pto-tool--slim flex w-6 items-center justify-center rounded hover:bg-black/5"
        >
          <IconPlus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export function ViewerToolbar({
  onToggleFullscreen,
  fullscreenActive = false,
  leading,
  extra,
}: {
  onToggleFullscreen?: () => void;
  fullscreenActive?: boolean;
  /** Переключатели источника листа (PDF / DWG). */
  leading?: ReactNode;
  extra?: ReactNode;
}) {
  if (!leading && !onToggleFullscreen && !extra) return null;
  return (
    <div
      onMouseDown={(event) => event.stopPropagation()}
      /**
       * Тот же вид, что у полосы под чертежом (ViewerStatusBar): раньше сверху
       * висела тёмная плашка, снизу светлые — и обе видны на каждом листе
       * одновременно. Чертёж теперь обрамлён одним хромом.
       */
      className="absolute right-1.5 top-1.5 z-30 flex items-center gap-0.5 rounded border border-border bg-white/92 px-0.5 py-[3px] text-text shadow-sm backdrop-blur"
      data-viewer-toolbar=""
    >
      {leading ? (
        <div className="flex items-center border-r border-border pr-1">
          {leading}
        </div>
      ) : null}
      {onToggleFullscreen ? (
        <button
          type="button"
          title={
            fullscreenActive
              ? "Показать текст листа рядом (F)"
              : "Чертёж на весь экран (F)"
          }
          aria-label={fullscreenActive ? "Свернуть чертёж" : "Весь экран"}
          onClick={() => onToggleFullscreen()}
          className={`pto-tool pto-tool--slim inline-flex w-6 items-center justify-center rounded border ${
            fullscreenActive
              ? "border-accent bg-accent text-white"
              : "border-border bg-white text-text hover:bg-black/5"
          }`}
        >
          <IconExpand className="h-3 w-3" />
        </button>
      ) : null}
      {extra}
    </div>
  );
}
