"use client";

import { useEffect, useRef, useState } from "react";
import { SegmentedTabs } from "@/components/ui-chrome";
import type { AnnotationRect, PageAnnotation } from "@/types";

type PdfPageProps = {
  url: string;
  pageNumber: number;
  annotations?: PageAnnotation[];
  markMode?: boolean;
  activeAnnotationId?: string | null;
  /** Смена значения — сброс вида и короткая вспышка «якорь». */
  highlightNonce?: number;
  /** Подсветка совпадений поиска на чертеже (текст PDF). */
  highlightQuery?: string;
  /** Синхронный скролл с markdown: колёсико панорамирует, ratio 0..1. */
  scrollSync?: boolean;
  scrollRatio?: number | null;
  onScrollRatioChange?: (ratio: number) => void;
  onMarkRect?: (rect: AnnotationRect) => void;
  onSelectAnnotation?: (id: string) => void;
  onCancelMark?: () => void;
};

type DrawState = { x0: number; y0: number; x1: number; y1: number };
type TextHit = { x: number; y: number; w: number; h: number };

const MIN_SIDE = 0.012;

export function PdfPage({
  url,
  pageNumber,
  annotations = [],
  markMode = false,
  activeAnnotationId = null,
  highlightNonce = 0,
  highlightQuery = "",
  scrollSync = false,
  scrollRatio = null,
  onScrollRatioChange,
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
  const applyingSync = useRef(false);
  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const naturalRef = useRef({ w: 800, h: 1100 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [natural, setNatural] = useState({ w: 800, h: 1100 });
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [grabbing, setGrabbing] = useState(false);
  const [draw, setDraw] = useState<DrawState | null>(null);
  const [anchorFlash, setAnchorFlash] = useState(false);
  const [searchHits, setSearchHits] = useState<TextHit[]>([]);
  const [fitMode, setFitMode] = useState<"page" | "width">("page");

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    naturalRef.current = natural;
  }, [natural]);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;

    (async () => {
      setLoading(true);
      setError(null);
      setSearchHits([]);
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

        const needle = highlightQuery.trim().toLowerCase();
        if (needle.length >= 2) {
          const content = await page.getTextContent();
          const hits: TextHit[] = [];
          const vt = viewport.transform;
          for (const item of content.items) {
            if (!("str" in item) || !item.str) continue;
            if (!item.str.toLowerCase().includes(needle)) continue;
            const t = item.transform;
            // viewport.transform × item.transform
            const a = vt[0] * t[0] + vt[2] * t[1];
            const b = vt[1] * t[0] + vt[3] * t[1];
            const c = vt[0] * t[2] + vt[2] * t[3];
            const d = vt[1] * t[2] + vt[3] * t[3];
            const e = vt[0] * t[4] + vt[2] * t[5] + vt[4];
            const f = vt[1] * t[4] + vt[3] * t[5] + vt[5];
            const fontHeight = Math.max(1, Math.hypot(c, d));
            const width = Math.max(1, (item.width ?? 0) * Math.hypot(a, b));
            hits.push({
              x: e / viewport.width,
              y: (f - fontHeight) / viewport.height,
              w: Math.max(0.01, width / viewport.width),
              h: Math.max(0.01, fontHeight / viewport.height),
            });
          }
          if (!cancelled) setSearchHits(hits);
        }

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
  }, [url, pageNumber, highlightQuery]);

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
    setFitMode(mode);
    setScale(Math.max(0.15, next));
    setPan({ x: pad / 2, y: pad / 2 });
  }

  function emitScrollRatio(nextPan: { x: number; y: number }, nextScale = scale) {
    if (!onScrollRatioChange || applyingSync.current) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const contentH = natural.h * nextScale;
    const maxPan = Math.max(1, contentH - wrap.clientHeight);
    const pad = 8;
    const ratio = Math.min(1, Math.max(0, (pad - nextPan.y) / maxPan));
    onScrollRatioChange(ratio);
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
    if (!scrollSync || scrollRatio == null) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    applyingSync.current = true;
    const contentH = natural.h * scale;
    const maxPan = Math.max(0, contentH - wrap.clientHeight);
    const pad = 8;
    setPan((prev) => ({
      ...prev,
      y: pad - scrollRatio * maxPan,
    }));
    requestAnimationFrame(() => {
      applyingSync.current = false;
    });
  }, [scrollRatio, natural.h, scale, scrollSync]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      // Shift+колёсико — вертикальный пан (синхрон с текстом); иначе зум в точку курсора.
      if (scrollSync && event.shiftKey) {
        const next = {
          ...panRef.current,
          y: panRef.current.y - event.deltaY,
        };
        panRef.current = next;
        setPan(next);
        emitScrollRatio(next, scaleRef.current);
        return;
      }
      const oldScale = scaleRef.current;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextScale = Math.min(8, Math.max(0.15, oldScale * factor));
      if (nextScale === oldScale) return;

      const rect = wrap.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      const oldPan = panRef.current;
      const contentX = (cx - oldPan.x) / oldScale;
      const contentY = (cy - oldPan.y) / oldScale;
      const nextPan = {
        x: cx - contentX * nextScale,
        y: cy - contentY * nextScale,
      };
      scaleRef.current = nextScale;
      panRef.current = nextPan;
      setScale(nextScale);
      setPan(nextPan);
      emitScrollRatio(nextPan, nextScale);
    };
    wrap.addEventListener("wheel", onWheelNative, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheelNative);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScrollRatioChange, natural.h, scrollSync]);

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
    const s = scaleRef.current;
    const p = panRef.current;
    const n = naturalRef.current;
    const x = (clientX - rect.left - p.x) / s / n.w;
    const y = (clientY - rect.top - p.y) / s / n.h;
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
    <div className="group relative flex h-full min-h-0 flex-col">
      <div
        ref={wrapRef}
        className={`relative min-h-0 flex-1 overflow-hidden bg-[#f7f8fa] ${cursor}`}
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
          const next = {
            x: drag.panX + (event.clientX - drag.x),
            y: drag.panY + (event.clientY - drag.y),
          };
          panRef.current = next;
          setPan(next);
          emitScrollRatio(next);
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
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-[#8b93a3]">
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
              className="block bg-white shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
            />
            {searchHits.map((hit, index) => (
              <div
                key={`q-${index}`}
                className="pointer-events-none absolute bg-amber-300/45 outline outline-1 outline-amber-500/80"
                style={{
                  left: `${hit.x * 100}%`,
                  top: `${hit.y * 100}%`,
                  width: `${hit.w * 100}%`,
                  height: `${hit.h * 100}%`,
                }}
              />
            ))}
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

      {/* Активные состояния — видны всегда, их прятать нельзя. */}
      {markMode || searchHits.length > 0 ? (
        <div className="pointer-events-none absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-1.5">
          {markMode ? (
            <span className="rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white shadow-md">
              Обведите место на чертеже · Esc — отмена
            </span>
          ) : null}
          {searchHits.length > 0 ? (
            <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 shadow-sm">
              найдено: {searchHits.length}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Масштаб меняют редко, а чертёж читают постоянно — панель проявляется по наведению. */}
      <div
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute bottom-2 right-2 z-30 flex items-center gap-2 rounded-md border border-border bg-white/90 px-1.5 py-1 opacity-0 shadow-sm backdrop-blur transition-opacity focus-within:opacity-100 hover:opacity-100 group-hover:opacity-100"
      >
        <SegmentedTabs
          size="xs"
          value={fitMode}
          onChange={(mode) => fit(mode)}
          options={[
            { id: "page", label: "Страница" },
            { id: "width", label: "По ширине" },
          ]}
        />
        <span className="pr-0.5 text-[11px] tabular-nums text-muted">
          {Math.round(scale * 100)} %{scrollSync ? " · sync" : ""}
        </span>
      </div>
    </div>
  );
}
