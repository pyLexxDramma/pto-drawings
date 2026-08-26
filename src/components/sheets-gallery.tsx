"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { KIND_LABEL, type DocumentPage, type PageKind } from "@/types";

type SheetsGalleryProps = {
  documentId: string;
  fileUrl: string;
  isCad: boolean;
  pages: number[];
  pageRecords: Map<number, DocumentPage>;
  kinds: Map<number, PageKind>;
  viewed: Set<number>;
  ready: Set<number>;
  annotated: Set<number>;
  edited: Set<number>;
  processingPage: number | null;
  currentPage: number;
  emptyLabel?: string;
  onSelect: (page: number) => void;
};

const THUMB_SCALE = 0.28;
const MAX_PARALLEL = 3;

function excerpt(markdown: string, max = 320) {
  const plain = markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/[#>*_`|\-\[\]!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

/** Сетка всех листов файла: превью + фрагмент расшифровки. */
export function SheetsGallery({
  documentId,
  fileUrl,
  isCad,
  pages,
  pageRecords,
  kinds,
  viewed,
  ready,
  annotated,
  edited,
  processingPage,
  currentPage,
  emptyLabel,
  onSelect,
}: SheetsGalleryProps) {
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const canvases = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const nodes = useRef<Map<number, HTMLElement>>(new Map());
  const rendered = useRef<Set<number>>(new Set());
  const visible = useRef<Set<number>>(new Set());
  const queue = useRef<number[]>([]);
  const inFlight = useRef(0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [pdfReady, setPdfReady] = useState(false);

  const pump = useCallback(() => {
    function run() {
      const pdf = pdfRef.current;
      if (!pdf) return;
      while (inFlight.current < MAX_PARALLEL) {
        const pageNumber = queue.current.shift();
        if (pageNumber === undefined) return;
        if (rendered.current.has(pageNumber)) continue;
        if (!visible.current.has(pageNumber)) continue;
        const canvas = canvases.current.get(pageNumber);
        if (!canvas) continue;
        inFlight.current += 1;
        rendered.current.add(pageNumber);
        void renderThumb(pdf, pageNumber, canvas)
          .catch(() => {
            rendered.current.delete(pageNumber);
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
    if (isCad) return;
    let cancelled = false;
    let task: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | null =
      null;
    rendered.current.clear();
    queue.current = [];
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        task = pdfjs.getDocument({ url: fileUrl, withCredentials: false });
        const pdf = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        pdfRef.current = pdf;
        setPdfReady(true);
        pump();
      } catch {
        if (!cancelled) setPdfReady(false);
      }
    })();
    return () => {
      cancelled = true;
      pdfRef.current = null;
      rendered.current.clear();
      setPdfReady(false);
      void task?.destroy();
    };
  }, [fileUrl, isCad, pump]);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNumber = Number(
            (entry.target as HTMLElement).dataset.pageNumber,
          );
          if (!Number.isFinite(pageNumber)) continue;
          if (entry.isIntersecting) {
            visible.current.add(pageNumber);
            if (!rendered.current.has(pageNumber)) {
              queue.current.push(pageNumber);
              pump();
            }
          } else {
            visible.current.delete(pageNumber);
          }
        }
      },
      { rootMargin: "200px 0px", threshold: 0.01 },
    );
    for (const node of nodes.current.values()) {
      observerRef.current.observe(node);
    }
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [pages, pump, pdfReady]);

  if (pages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted">
        {emptyLabel ?? "Нет листов для показа."}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#f4f6f9] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
        <div className="text-sm font-semibold text-text">
          Все листы
          <span className="ml-2 text-xs font-normal text-muted">
            {pages.length} · клик — открыть для проверки
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {pages.map((pageNumber) => {
          const record = pageRecords.get(pageNumber);
          const kind = kinds.get(pageNumber);
          const isReady = ready.has(pageNumber);
          const isWorking = processingPage === pageNumber;
          const text = record?.markdown ? excerpt(record.markdown) : "";
          const isCurrent = pageNumber === currentPage;

          return (
            <button
              key={pageNumber}
              type="button"
              data-page-number={pageNumber}
              ref={(node) => {
                if (node) {
                  nodes.current.set(pageNumber, node);
                  observerRef.current?.observe(node);
                } else {
                  const prev = nodes.current.get(pageNumber);
                  if (prev) observerRef.current?.unobserve(prev);
                  nodes.current.delete(pageNumber);
                  visible.current.delete(pageNumber);
                }
              }}
              onClick={() => onSelect(pageNumber)}
              className={`flex flex-col overflow-hidden rounded-xl border bg-white text-left shadow-sm transition hover:border-accent/60 hover:shadow-md ${
                isCurrent
                  ? "border-accent ring-2 ring-accent/25"
                  : "border-border"
              }`}
            >
              <div className="relative aspect-[1/0.72] bg-slate-100">
                {isCad ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/documents/${documentId}/pages/${pageNumber}/preview?format=png`}
                    alt=""
                    className="h-full w-full object-contain bg-white"
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <canvas
                    ref={(node) => {
                      if (node) canvases.current.set(pageNumber, node);
                      else canvases.current.delete(pageNumber);
                    }}
                    className="h-full w-full object-contain bg-white"
                  />
                )}
                {!isReady && !isWorking ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-[11px] text-muted">
                    Текст ещё не готов
                  </div>
                ) : null}
                {isWorking ? (
                  <div className="absolute left-2 top-2 rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    обрабатывается
                  </div>
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-1.5 border-t border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold tabular-nums">
                    Лист {pageNumber}
                  </span>
                  <span className="flex items-center gap-1">
                    {viewed.has(pageNumber) ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Просмотрено" />
                    ) : null}
                    {edited.has(pageNumber) ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Правили" />
                    ) : null}
                    {annotated.has(pageNumber) ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500" title="Замечание" />
                    ) : null}
                    {isReady ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Готово" />
                    ) : null}
                  </span>
                </div>
                <div className="text-[11px] text-muted">
                  {kind ? KIND_LABEL[kind] : isWorking ? "В работе" : "Лист"}
                </div>
                <div className="line-clamp-4 text-[12px] leading-snug text-text/90">
                  {text || (
                    <span className="text-muted">
                      {isReady ? "Пустая расшифровка" : "Ожидает расшифровку"}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
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
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
}
