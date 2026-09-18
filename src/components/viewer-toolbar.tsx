"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconExpand } from "@/components/tool-icons";
import type { FitMode } from "@/hooks/use-page-viewport";

const PERCENTS = [50, 100, 200, 400];

export function ViewerToolbar({
  scale,
  fitMode,
  onFit,
  onZoomBy,
  onSetPercent,
  onPrevPage,
  onNextPage,
  canPrevPage = false,
  canNextPage = false,
  onToggleFullscreen,
  fullscreenActive = false,
  extra,
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
  onToggleFullscreen?: () => void;
  fullscreenActive?: boolean;
  extra?: ReactNode;
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

  // Тёмный полупрозрачный фон: кнопки читаются на любом чертеже, но лист
  // сквозь них виден (созвон 18.09).
  return (
    <div
      ref={rootRef}
      onMouseDown={(event) => event.stopPropagation()}
      className="absolute right-1.5 top-1.5 z-30 flex items-center gap-0.5 rounded border border-white/15 bg-slate-900/55 px-0.5 py-[3px] text-white shadow-md backdrop-blur"
      data-viewer-toolbar=""
    >
      {onPrevPage || onNextPage ? (
        <div className="flex items-center overflow-hidden rounded border border-white/20 bg-white/10">
          <button
            type="button"
            title="Предыдущий лист (K / PageUp)"
            aria-label="Предыдущий лист"
            onClick={() => onPrevPage?.()}
            disabled={!canPrevPage}
            className="pto-tool pto-tool--slim inline-flex w-6 items-center justify-center text-xs font-bold text-white hover:bg-white/20 disabled:cursor-default disabled:opacity-40"
          >
            ←
          </button>
          <button
            type="button"
            title="Следующий лист (J / PageDown / пробел)"
            aria-label="Следующий лист"
            onClick={() => onNextPage?.()}
            disabled={!canNextPage}
            className="pto-tool pto-tool--slim inline-flex w-6 items-center justify-center border-l border-white/20 text-xs font-bold text-white hover:bg-white/20 disabled:cursor-default disabled:opacity-40"
          >
            →
          </button>
        </div>
      ) : null}
      <div
        className={`flex items-center gap-0.5 ${
          onPrevPage || onNextPage ? "border-l border-white/20 pl-1" : ""
        }`}
      >
        <button
          type="button"
          title="Отдалить"
          aria-label="Отдалить"
          onClick={() => onZoomBy(1 / 1.25)}
          className="pto-tool pto-tool--slim flex w-6 items-center justify-center rounded text-sm leading-none text-white hover:bg-white/20"
        >
          −
        </button>
        <div className="relative">
          <button
            type="button"
            title="Масштаб — выбрать или вписать лист"
            aria-expanded={open}
            aria-haspopup="listbox"
            onClick={() => setOpen((value) => !value)}
            className="pto-tool pto-tool--slim min-w-[2.5rem] rounded px-0.5 text-center text-[11px] font-medium tabular-nums text-white hover:bg-white/20"
            data-viewer-scale=""
          >
            {Math.round(scale * 100)}%
          </button>
          {open ? (
            <div
              role="listbox"
              className="absolute right-0 top-full z-40 mt-1 min-w-[8.5rem] rounded-md border border-border bg-white py-1 text-xs shadow-md"
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
          className="pto-tool pto-tool--slim flex w-6 items-center justify-center rounded text-sm leading-none text-white hover:bg-white/20"
        >
          +
        </button>
      </div>
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
              : "border-white/20 bg-white/10 text-white hover:bg-white/20"
          }`}
        >
          <IconExpand className="h-3 w-3" />
        </button>
      ) : null}
      {extra}
    </div>
  );
}
