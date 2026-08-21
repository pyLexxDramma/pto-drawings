"use client";

import { useEffect, useRef, useState } from "react";
import type { AnnotationRect, PageAnnotation } from "@/types";

type PdfPageProps = {
  url: string;
  pageNumber: number;
  annotations?: PageAnnotation[];
  markMode?: boolean;
  activeAnnotationId?: string | null;
  /** Смена значения — сброс вида и короткая вспышка «якорь». */
  highlightNonce?: number;
  onMarkRect?: (rect: AnnotationRect) => void;
  onSelectAnnotation?: (id: string) => void;
  onCancelMark?: () => void;
};

type DrawState = { x0: number; y0: number; x1: number; y1: number };

const MIN_SIDE = 0.012;

export function PdfPage({
  url,
  pageNumber,
  annotations = [],
  markMode = false,
  activeAnnotationId = null,
  highlightNonce = 0,
  onMarkRect,
  onSelectAnnotation,
  onCancelMark,
}: PdfPageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [natural, setNatural] = useState({ w: 800, h: 1100 });
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [grabbing, setGrabbing] = useState(false);
  const [draw, setDraw] = useState<DrawState | null>(null);
  const [anchorFlash, setAnchorFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({ url, withCredentials: false });
        destroy = () => task.destroy();
        const pdf = await task.promise;
        if (cancelled) return;
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        setNatural({ w: viewport.width, h: viewport.height });
        await page.render({
          canvas,
          canvasContext: context,
          viewport,
        }).promise;
        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) {
          setError("Не удалось показать страницу");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [url, pageNumber]);

  function fit(mode: "page" | "width") {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const pad = 16;
    const next =
      mode === "width"
        ? (wrap.clientWidth - pad) / natural.w
        : Math.min(
            (wrap.clientWidth - pad) / natural.w,
            (wrap.clientHeight - pad) / natural.h,
          );
    setScale(Math.max(0.15, next));
    setPan({ x: pad / 2, y: pad / 2 });
  }

  useEffect(() => {
    if (!loading && !error) fit("page");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, natural.w, natural.h, pageNumber]);

  useEffect(() => {
    if (!highlightNonce) return;
    fit("page");
    setAnchorFlash(true);
    const timer = window.setTimeout(() => setAnchorFlash(false), 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightNonce]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      setScale((value) => Math.min(8, Math.max(0.15, value * factor)));
    };
    wrap.addEventListener("wheel", onWheelNative, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheelNative);
  }, []);

  useEffect(() => {
    if (!markMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelMark?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markMode, onCancelMark]);

  /** Экранная точка -> доля от размера листа, чтобы метка не зависела от зума. */
  function toPagePoint(clientX: number, clientY: number) {
    const wrap = wrapRef.current;
    if (!wrap) return { x: 0, y: 0 };
    const rect = wrap.getBoundingClientRect();
    const x = (clientX - rect.left - pan.x) / scale / natural.w;
    const y = (clientY - rect.top - pan.y) / scale / natural.h;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };
  }

  function finishDraw(state: DrawState) {
    const x = Math.min(state.x0, state.x1);
    const y = Math.min(state.y0, state.y1);
    let w = Math.abs(state.x1 - state.x0);
    let h = Math.abs(state.y1 - state.y0);
    if (w < MIN_SIDE && h < MIN_SIDE) {
      w = 0.05;
      h = 0.05;
    }
    onMarkRect?.({
      x,
      y,
      w: Math.min(1 - x, Math.max(MIN_SIDE, w)),
      h: Math.min(1 - y, Math.max(MIN_SIDE, h)),
    });
  }

  const preview = markMode && draw
    ? {
        x: Math.min(draw.x0, draw.x1),
        y: Math.min(draw.y0, draw.y1),
        w: Math.abs(draw.x1 - draw.x0),
        h: Math.abs(draw.y1 - draw.y0),
      }
    : null;

  const cursor = markMode ? "cursor-crosshair" : grabbing ? "cursor-grabbing" : "cursor-grab";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-white px-2 py-1">
        <button
          type="button"
          onClick={() => fit("page")}
          className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-bg"
        >
          Страница
        </button>
        <button
          type="button"
          onClick={() => fit("width")}
          className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-bg"
        >
          По ширине
        </button>
        {markMode ? (
          <span className="ml-2 rounded bg-red-50 px-2 py-0.5 text-[11px] text-red-700">
            Обведите место на чертеже · Esc — отмена
          </span>
        ) : null}
        <span className="ml-auto text-[11px] text-muted">
          {Math.round(scale * 100)} % Zoom
        </span>
      </div>
      <div
        ref={wrapRef}
        className={`relative min-h-0 flex-1 overflow-hidden bg-[#eceff3] ${cursor}`}
        onWheel={(event) => event.preventDefault()}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          if (markMode) {
            const point = toPagePoint(event.clientX, event.clientY);
            setDraw({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
            return;
          }
          setGrabbing(true);
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            panX: pan.x,
            panY: pan.y,
          };
        }}
        onMouseMove={(event) => {
          if (markMode) {
            if (!draw) return;
            const point = toPagePoint(event.clientX, event.clientY);
            setDraw({ ...draw, x1: point.x, y1: point.y });
            return;
          }
          const drag = dragRef.current;
          if (!drag) return;
          setPan({
            x: drag.panX + (event.clientX - drag.x),
            y: drag.panY + (event.clientY - drag.y),
          });
        }}
        onMouseUp={() => {
          if (markMode) {
            if (draw) finishDraw(draw);
            setDraw(null);
            return;
          }
          dragRef.current = null;
          setGrabbing(false);
        }}
        onMouseLeave={() => {
          dragRef.current = null;
          setGrabbing(false);
          setDraw(null);
        }}
      >
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted">
            Страница загружается…
          </div>
        ) : null}
        {anchorFlash ? (
          <div className="pointer-events-none absolute inset-0 z-20 animate-pulse border-4 border-sky-400/80 bg-sky-300/10" />
        ) : null}
        {error ? (
          <iframe
            title="PDF"
            src={`${url}#page=${pageNumber}`}
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          // Метки лежат в том же трансформированном слое, что и canvas, поэтому едут вместе с чертежом.
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: natural.w,
              height: natural.h,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            }}
          >
            <canvas
              ref={canvasRef}
              className="block bg-white shadow-[0_8px_30px_rgba(15,23,42,0.12)]"
            />
            {annotations.map((annotation, index) => {
              const isActive = annotation.id === activeAnnotationId;
              const isOpen = annotation.status === "open";
              return (
                <button
                  key={annotation.id}
                  type="button"
                  title={annotation.comment}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectAnnotation?.(annotation.id);
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                  className="absolute"
                  style={{
                    left: `${annotation.rect.x * 100}%`,
                    top: `${annotation.rect.y * 100}%`,
                    width: `${annotation.rect.w * 100}%`,
                    height: `${annotation.rect.h * 100}%`,
                    borderStyle: "solid",
                    borderWidth: Math.max(1, 2 / scale),
                    borderColor: isOpen ? "#dc2626" : "#059669",
                    background: isActive
                      ? "rgba(220,38,38,0.16)"
                      : "rgba(220,38,38,0.05)",
                  }}
                >
                  <span
                    className="absolute font-semibold text-white"
                    style={{
                      left: 0,
                      top: 0,
                      transform: "translate(-2%, -105%)",
                      background: isOpen ? "#dc2626" : "#059669",
                      padding: `${1 / scale}px ${4 / scale}px`,
                      borderRadius: 3 / scale,
                      fontSize: Math.max(6, 13 / scale),
                      lineHeight: 1.4,
                    }}
                  >
                    {index + 1}
                  </span>
                </button>
              );
            })}
            {preview ? (
              <div
                className="pointer-events-none absolute"
                style={{
                  left: `${preview.x * 100}%`,
                  top: `${preview.y * 100}%`,
                  width: `${preview.w * 100}%`,
                  height: `${preview.h * 100}%`,
                  border: `${Math.max(1, 2 / scale)}px dashed #dc2626`,
                  background: "rgba(220,38,38,0.1)",
                }}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
