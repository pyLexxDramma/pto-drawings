"use client";

import { useEffect, useRef } from "react";
import { KIND_LABEL, type PageKind } from "@/types";

type PageStripProps = {
  url: string;
  total: number;
  current: number;
  kinds: Map<number, PageKind>;
  edited: Set<number>;
  viewed: Set<number>;
  ready: Set<number>;
  hidden?: Set<number>;
  processingPage: number | null;
  onSelect: (page: number) => void;
};

export function PageStrip({
  url,
  total,
  current,
  kinds,
  edited,
  viewed,
  ready,
  hidden,
  processingPage,
  onSelect,
}: PageStripProps) {
  const canvases = useRef<Map<number, HTMLCanvasElement>>(new Map());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({ url, withCredentials: false });
        const pdf = await task.promise;
        if (cancelled) return;
        const count = Math.min(total, pdf.numPages);
        for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
          const canvas = canvases.current.get(pageNumber);
          if (!canvas) continue;
          const page = await pdf.getPage(pageNumber);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 0.22 });
          const context = canvas.getContext("2d");
          if (!context) continue;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({
            canvas,
            canvasContext: context,
            viewport,
          }).promise;
        }
        await task.destroy();
      } catch {
        // thumbnails are optional
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, total]);

  const pages = Array.from({ length: total }, (_, index) => index + 1).filter(
    (pageNumber) => !hidden?.has(pageNumber),
  );

  return (
    <div className="flex h-full w-[108px] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface-2 p-1.5">
      {pages.map((pageNumber) => {
        const kind = kinds.get(pageNumber);
        const isEdited = edited.has(pageNumber);
        const isViewed = viewed.has(pageNumber);
        const isReady = ready.has(pageNumber);
        const isWorking = processingPage === pageNumber;
        return (
          <button
            key={pageNumber}
            type="button"
            onClick={() => onSelect(pageNumber)}
            className={`mb-1.5 rounded-md border p-1 text-left ${
              current === pageNumber
                ? "border-accent bg-white"
                : "border-transparent hover:border-border hover:bg-white"
            }`}
          >
            <canvas
              ref={(node) => {
                if (node) canvases.current.set(pageNumber, node);
                else canvases.current.delete(pageNumber);
              }}
              className="w-full rounded-[3px] bg-white"
            />
            <div className="mt-1 flex items-center justify-between gap-1">
              <span className="text-[10px] font-medium">{pageNumber}</span>
              <span className="flex items-center gap-0.5">
                {isWorking ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500" title="Сейчас обрабатывается" />
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
