"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPdfThumb } from "@/lib/pdf-thumb";
import { PaneToggle } from "@/components/ui-chrome";
import { SEVERITY_DOT, VERDICT_DOT } from "@/lib/review-colors";
import {
  KIND_LABEL,
  REVIEW_SEVERITY_LABEL,
  REVIEW_VERDICT_LABEL,
  type PageKind,
  type ReviewSeverity,
  type ReviewVerdict,
} from "@/types";

function StatusDot({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span className="group/dot relative inline-flex" title={label}>
      <span className={`h-3 w-3 rounded-full ${className}`} />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-1.5 py-0.5 text-[10px] leading-none text-white shadow-sm group-hover/dot:block">
        {label}
      </span>
    </span>
  );
}

type PageStripProps = {
  url: string;
  total: number;
  current: number;
  kinds: Map<number, PageKind>;
  edited: Set<number>;
  viewed: Set<number>;
  pageDots?: Map<number, { severity: ReviewSeverity; verdict: ReviewVerdict }>;
  ready: Set<number>;
  annotated?: Set<number>;
  hidden?: Set<number>;
  processingPage: number | null;
  width?: number;
  emptyLabel?: string;
  onSelect: (page: number) => void;
  onCollapse?: () => void;
  /** В колонке проектов: на всю ширину, без своей кнопки свернуть. */
  embedded?: boolean;
};

const MAX_PARALLEL_RENDERS = 2;

export function PageStrip({
  url,
  total,
  current,
  kinds,
  edited,
  viewed: _viewed,
  pageDots,
  ready,
  annotated,
  hidden,
  processingPage,
  width = 108,
  emptyLabel,
  onSelect,
  onCollapse,
  embedded = false,
}: PageStripProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvases = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const nodes = useRef<Map<number, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderedPages = useRef<Set<number>>(new Set());
  const visiblePages = useRef<Set<number>>(new Set());
  const queue = useRef<number[]>([]);
  const inFlight = useRef(0);
  const currentRef = useRef(current);

  const pump = useCallback(() => {
    function run() {
      const pdf = pdfRef.current;
      if (!pdf) return;

      while (inFlight.current < MAX_PARALLEL_RENDERS) {
        const pageNumber = queue.current.shift();
        if (pageNumber === undefined) return;
        if (renderedPages.current.has(pageNumber)) continue;
        if (!visiblePages.current.has(pageNumber)) continue;
        const canvas = canvases.current.get(pageNumber);
        if (!canvas) continue;

        inFlight.current += 1;
        renderedPages.current.add(pageNumber);
        void renderPdfThumb(pdf, pageNumber, canvas)
          .catch(() => {
            // даём шанс перерисовать лист, когда он снова попадёт в кадр
            renderedPages.current.delete(pageNumber);
          })
          .finally(() => {
            inFlight.current -= 1;
            run();
          });
      }
    }
    run();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | null =
      null;

    renderedPages.current.clear();
    queue.current = [];

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        task = pdfjs.getDocument({ url, withCredentials: false });
        const pdf = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        pdfRef.current = pdf;
        visiblePages.current.add(currentRef.current);
        queue.current.unshift(currentRef.current);
        pump();
      } catch {
        // миниатюры необязательны: сам лист всё равно откроется
      }
    })();

    return () => {
      cancelled = true;
      pdfRef.current = null;
      void task?.destroy();
    };
  }, [pump, url]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNumber = Number((entry.target as HTMLElement).dataset.page);
          if (!pageNumber) continue;
          if (entry.isIntersecting) {
            visiblePages.current.add(pageNumber);
            if (!renderedPages.current.has(pageNumber)) queue.current.push(pageNumber);
          } else {
            visiblePages.current.delete(pageNumber);
          }
        }
        pump();
      },
      { root: rootRef.current, rootMargin: "400px 0px" },
    );

    observerRef.current = observer;
    for (const node of nodes.current.values()) observer.observe(node);

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [pump]);

  useEffect(() => {
    // Открытый лист рисуем первым, даже если полоса пролистана в другое место.
    currentRef.current = current;
    visiblePages.current.add(current);
    if (!renderedPages.current.has(current)) queue.current.unshift(current);
    pump();
  }, [current, pump]);

  const pages = Array.from({ length: total }, (_, index) => index + 1).filter(
    (pageNumber) => !hidden?.has(pageNumber),
  );

  return (
    <div
      className={
        embedded
          ? "flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface-2"
          : "flex h-full min-h-0 shrink-0 flex-col border-r border-border bg-surface-2"
      }
      style={embedded ? undefined : { width }}
    >
      {embedded ? (
        <div className="shrink-0 border-b border-border px-2 py-1 text-[10px] font-semibold text-muted">
          Листы
        </div>
      ) : onCollapse ? (
        <div className="flex shrink-0 items-center justify-end border-b border-border px-1 py-1">
          <PaneToggle
            expanded
            align="left"
            expandLabel="Показать список листов"
            collapseLabel="Скрыть список листов"
            onToggle={onCollapse}
          />
        </div>
      ) : null}
      <div ref={rootRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
      {pages.length === 0 && emptyLabel ? (
        <div className="px-1 py-2 text-[10px] leading-snug text-muted">{emptyLabel}</div>
      ) : null}
      {pages.map((pageNumber) => {
        const kind = kinds.get(pageNumber);
        const isEdited = edited.has(pageNumber);
        const dots = pageDots?.get(pageNumber);
        const isReady = ready.has(pageNumber);
        const isFlagged = annotated?.has(pageNumber) ?? false;
        const isWorking = processingPage === pageNumber;
        return (
          <button
            key={pageNumber}
            type="button"
            data-page={pageNumber}
            ref={(node) => {
              const previous = nodes.current.get(pageNumber);
              if (previous && previous !== node) {
                observerRef.current?.unobserve(previous);
              }
              if (node) {
                nodes.current.set(pageNumber, node);
                observerRef.current?.observe(node);
              } else {
                nodes.current.delete(pageNumber);
                visiblePages.current.delete(pageNumber);
              }
            }}
            onClick={() => onSelect(pageNumber)}
            className={`mb-1.5 overflow-visible rounded-md border p-1 text-left transition-[opacity,transform,box-shadow] duration-150 ${
              current === pageNumber
                ? "z-[1] scale-[1.02] border-accent bg-white shadow-[0_0_0_2px_rgba(37,99,235,0.25)]"
                : isWorking
                  ? "pto-page-working border-sky-400 bg-white opacity-90"
                  : "border-transparent opacity-45 hover:border-border hover:bg-white hover:opacity-100"
            }`}
          >
            {/* Постоянная высота места под миниатюру: иначе все листы сразу попадают в кадр. */}
            <span className="block aspect-[1/1.41] w-full overflow-hidden rounded-[3px] bg-white">
              <canvas
                ref={(node) => {
                  if (node) canvases.current.set(pageNumber, node);
                  else canvases.current.delete(pageNumber);
                }}
                className="h-full w-full object-contain"
              />
            </span>
            <div className="mt-1 flex items-center justify-between gap-1">
              <span className="text-[10px] font-medium">{pageNumber}</span>
              <span className="flex items-center gap-1 overflow-visible">
                {isWorking ? (
                  <StatusDot
                    className="animate-pulse bg-sky-500 motion-reduce:animate-none"
                    label="Сейчас обрабатывается"
                  />
                ) : isReady ? (
                  <StatusDot className="bg-emerald-500" label="Текст готов" />
                ) : (
                  <StatusDot className="bg-slate-300" label="Ждёт текст" />
                )}
                {dots ? (
                  <>
                    <StatusDot
                      className={SEVERITY_DOT[dots.severity]}
                      label={`Важность: ${REVIEW_SEVERITY_LABEL[dots.severity]}`}
                    />
                    <StatusDot
                      className={VERDICT_DOT[dots.verdict]}
                      label={`Разбор: ${REVIEW_VERDICT_LABEL[dots.verdict]}`}
                    />
                  </>
                ) : isFlagged ? (
                  <StatusDot className="bg-red-500" label="Есть отметка" />
                ) : isEdited ? (
                  <StatusDot className="bg-amber-500" label="Лист правили" />
                ) : null}
              </span>
            </div>
            <div className="truncate text-[9px] text-muted">
              {kind ? KIND_LABEL[kind].toLowerCase() : isWorking ? "сейчас" : "лист"}
            </div>
          </button>
        );
      })}
      </div>
    </div>
  );
}

