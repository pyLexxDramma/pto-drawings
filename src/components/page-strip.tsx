"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { KIND_LABEL, type PageKind } from "@/types";

type PageStripProps = {
  url: string;
  total: number;
  current: number;
  kinds: Map<number, PageKind>;
  edited: Set<number>;
  viewed: Set<number>;
  ready: Set<number>;
  annotated?: Set<number>;
  hidden?: Set<number>;
  processingPage: number | null;
  onSelect: (page: number) => void;
};

const THUMB_SCALE = 0.22;
const MAX_PARALLEL_RENDERS = 2;

export function PageStrip({
  url,
  total,
  current,
  kinds,
  edited,
  viewed,
  ready,
  annotated,
  hidden,
  processingPage,
  onSelect,
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
        void renderThumb(pdf, pageNumber, canvas)
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
        const pdfjs = await import("pdfjs-dist");
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
      ref={rootRef}
      className="flex h-full w-[108px] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface-2 p-1.5"
    >
      {pages.map((pageNumber) => {
        const kind = kinds.get(pageNumber);
        const isEdited = edited.has(pageNumber);
        const isViewed = viewed.has(pageNumber);
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
            className={`mb-1.5 rounded-md border p-1 text-left transition-[opacity,transform,box-shadow] duration-150 ${
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
              <span className="flex items-center gap-0.5">
                {isWorking ? (
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500 motion-reduce:animate-none"
                    title="Сейчас обрабатывается"
                  />
                ) : isReady ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Текст готов" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-300" title="Ждёт текст" />
                )}
                {isViewed ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Просмотрено" />
                ) : null}
                {isEdited ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Лист правили" />
                ) : null}
                {isFlagged ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" title="Есть замечание" />
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
  );
}

async function renderThumb(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
) {
  if (pageNumber > pdf.numPages) return;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: THUMB_SCALE });
  const context = canvas.getContext("2d");
  if (!context) return;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  page.cleanup();
}
