"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { HighlightLegend, SearchHitBadge } from "@/components/ui-chrome";
import { VIEWER_MOUSE_HINT } from "@/components/viewer-hint";
import { ViewerStatusBar } from "@/components/viewer-status-bar";
import { ViewerSheetControls, ViewerToolbar } from "@/components/viewer-toolbar";
import { LEGIBLE_MIN_PX, usePageViewport } from "@/hooks/use-page-viewport";
import { useSearchHitFocus } from "@/hooks/use-search-hit-focus";
import {
  regionAtPoint,
  type PageTextRegion,
} from "@/lib/content-sync";
import { findLayerHits, hitsInsideRegion } from "@/lib/highlight-text";
import {
  loadViewerPrefs,
  saveViewerPrefs,
  shouldShowViewerHint,
} from "@/lib/viewer-prefs";
import type { AnnotationRect, PageAnnotation } from "@/types";

type PdfPageProps = {
  url: string;
  pageNumber: number;
  viewCacheKey?: string;
  annotations?: PageAnnotation[];
  markMode?: boolean;
  activeAnnotationId?: string | null;
  highlightNonce?: number;
  highlightQuery?: string;
  highlightRegion?: PageTextRegion | null;
  highlightRegions?: PageTextRegion[];
  panToHighlight?: boolean;
  remarkFocus?: boolean;
  hoverRegions?: PageTextRegion[];
  onHoverRegion?: (regionId: string | null) => void;
  onSelectRegion?: (regionId: string | null) => void;
  onHighlightHits?: (count: number) => void;
  onMarkRect?: (rect: AnnotationRect) => void;
  onSelectAnnotation?: (id: string) => void;
  onCancelMark?: () => void;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  canPrevPage?: boolean;
  canNextPage?: boolean;
  onToggleFullscreen?: () => void;
  fullscreenActive?: boolean;
  /** Плашки разбора («Место N из M») в общий ряд поверх листа. */
  overlay?: ReactNode;
  /** Переключатель PDF / DWG — внутрь тулбара, а не отдельной плашкой. */
  toolbarLeading?: ReactNode;
};

type DrawState = { x0: number; y0: number; x1: number; y1: number };
type TextHit = { x: number; y: number; w: number; h: number };

const MIN_SIDE = 0.012;

/**
 * Лист рисуем с запасом x2 — так текст остаётся резким при зуме. Но на A0 это
 * ~32 Мп: Safari отдаёт пустой canvas, слабые машины упираются в память.
 * Держим потолок по площади, уменьшая масштаб только там, где он не влезает.
 */
const RENDER_SCALE = 2;
const MAX_CANVAS_PX = 16e6;

function renderScale(natural: { width: number; height: number }) {
  const area = natural.width * natural.height;
  if (!(area > 0)) return RENDER_SCALE;
  return Math.max(0.5, Math.min(RENDER_SCALE, Math.sqrt(MAX_CANVAS_PX / area)));
}

/**
 * Высота подписи для «Читаемо»: верхняя половина размеров, не медиана всех
 * глифов. Мелкие крошки (буква в ячейке) иначе задирают масштаб, и длинная
 * строка заголовка обрезается.
 */
function legibleTextHeight(
  items: Array<{ str?: string; transform?: number[] }>,
  vt: number[],
): number {
  const heights: number[] = [];
  for (const item of items) {
    if (!item.str?.trim() || !item.transform) continue;
    const t = item.transform;
    const c = vt[0] * t[2] + vt[2] * t[3];
    const d = vt[1] * t[2] + vt[3] * t[3];
    const h = Math.hypot(c, d);
    if (h > 0.2) heights.push(h);
  }
  if (!heights.length) return 0;
  heights.sort((a, b) => a - b);
  const upper = heights.slice(Math.floor(heights.length / 2));
  return upper[Math.floor(upper.length / 2)] ?? 0;
}

/** Ширина самой длинной крупной строки. Мелкие размеры на всю ширину листа не берём. */
function widestLinePx(
  items: Array<{ str?: string; transform?: number[]; width?: number }>,
  vt: number[],
  minHeight: number,
  pageWidth: number,
): number {
  const lines = new Map<number, { min: number; max: number }>();
  for (const item of items) {
    if (!item.str?.trim() || !item.transform) continue;
    const t = item.transform;
    const glyph = Math.hypot(vt[0] * t[2] + vt[2] * t[3], vt[1] * t[2] + vt[3] * t[3]);
    if (glyph < minHeight) continue;
    const x = vt[0] * t[4] + vt[2] * t[5] + vt[4];
    const y = vt[1] * t[4] + vt[3] * t[5] + vt[5];
    const wScale = Math.hypot(vt[0] * t[0] + vt[2] * t[1], vt[1] * t[0] + vt[3] * t[1]);
    const w = (item.width || item.str.length * 4) * (wScale || 1);
    const key = Math.round(y / 2);
    const span = lines.get(key) ?? { min: Number.POSITIVE_INFINITY, max: 0 };
    span.min = Math.min(span.min, x);
    span.max = Math.max(span.max, x + w);
    lines.set(key, span);
  }
  let widest = 0;
  const limit = pageWidth * 0.82;
  for (const span of lines.values()) {
    const width = span.max - span.min;
    if (width >= limit) continue;
    widest = Math.max(widest, width);
  }
  return widest;
}

export function PdfPage({
  url,
  pageNumber,
  viewCacheKey,
  annotations = [],
  markMode = false,
  activeAnnotationId = null,
  highlightNonce = 0,
  highlightQuery = "",
  highlightRegion = null,
  highlightRegions = [],
  panToHighlight = false,
  remarkFocus = false,
  hoverRegions = [],
  onHoverRegion,
  onSelectRegion,
  onHighlightHits,
  onMarkRect,
  onSelectAnnotation,
  onCancelMark,
  onPrevPage,
  onNextPage,
  canPrevPage = false,
  canNextPage = false,
  onToggleFullscreen,
  fullscreenActive = false,
  overlay,
  toolbarLeading,
}: PdfPageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [natural, setNatural] = useState({ w: 800, h: 1100 });
  const [draw, setDraw] = useState<DrawState | null>(null);
  const [zoomBox, setZoomBox] = useState<DrawState | null>(null);
  const [searchHits, setSearchHits] = useState<TextHit[]>([]);
  const [legibleTextPx, setLegibleTextPx] = useState(0);
  const [widestLine, setWidestLine] = useState(0);
  const [hintOn, setHintOn] = useState(() => shouldShowViewerHint(loadViewerPrefs()));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<{ url: string; pdf: any } | null>(null);
  const textContentRef = useRef<{
    items: Array<{ str?: string; transform?: number[]; width?: number }>;
    viewport: { width: number; height: number; transform: number[] };
  } | null>(null);

  const ready = !loading && !error;
  const focusRegion =
    highlightRegion ??
    (remarkFocus && searchHits[0] ? searchHits[0] : null);
  const viewport = usePageViewport({
    wrapRef,
    natural,
    pageNumber,
    ready,
    viewCacheKey,
    legibleTextPx,
    widestLinePx: widestLine,
    highlightNonce,
    highlightRegion: focusRegion,
    panToHighlight: panToHighlight || remarkFocus,
    wheelMode: "pan",
    onUserZoom: () => {
      const prefs = loadViewerPrefs();
      if (!prefs.hintDismissed) {
        saveViewerPrefs({ ...prefs, hintDismissed: true });
        setHintOn(false);
      }
    },
  });
  const hitFocus = useSearchHitFocus({
    hits: searchHits,
    query: highlightQuery,
    pageNumber,
    ready,
    auto: !remarkFocus,
    zoomToRect: viewport.zoomToRect,
  });
  // Легенда нужна только на листе из разбора: в свободном поиске зелёной рамки
  // нет и объяснять нечего.
  const legendOn =
    remarkFocus && (Boolean(highlightRegion) || searchHits.length > 0);
  // А1 «по ширине» — это 13% и подписи в 2px. Пока лист открыт мельче порога,
  // предлагаем перейти на читаемый масштаб.
  const legibleWarning =
    ready &&
    viewport.textOnScreenPx > 0 &&
    viewport.textOnScreenPx < LEGIBLE_MIN_PX &&
    viewport.legibleScale > viewport.scale * 1.15
      ? `${Math.round(viewport.scale * 100)}% — подписи не читаются`
      : null;

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;

    function isAbort(err: unknown) {
      const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
      const msg = err instanceof Error ? err.message : String(err ?? "");
      return (
        name === "AbortException" ||
        name === "RenderingCancelledException" ||
        /abort|cancel/i.test(msg)
      );
    }

    (async () => {
      setLoading(true);
      setError(null);
      setSearchHits([]);
      setLegibleTextPx(0);
      setWidestLine(0);
      textContentRef.current = null;
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        let pdf = pdfDocRef.current?.url === url ? pdfDocRef.current.pdf : null;
        if (!pdf) {
          const stale = pdfDocRef.current;
          pdfDocRef.current = null;
          await stale?.pdf?.destroy?.().catch(() => {});
          for (let attempt = 0; attempt < 3 && !pdf; attempt += 1) {
            if (cancelled) return;
            try {
              const res = await fetch(url, { credentials: "include" });
              if (!res.ok) throw new Error(`pdf http ${res.status}`);
              const data = new Uint8Array(await res.arrayBuffer());
              if (cancelled) return;
              const task = pdfjs.getDocument({ data });
              const loaded = await task.promise;
              if (cancelled) {
                try {
                  void (loaded as { destroy?: () => void }).destroy?.();
                } catch {
                  /* ignore */
                }
                return;
              }
              pdfDocRef.current = { url, pdf: loaded };
              pdf = loaded;
            } catch (err) {
              if (cancelled || isAbort(err)) return;
              if (attempt === 2) throw err;
              await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
            }
          }
        }
        if (!pdf) throw new Error("pdf missing");

        const page = await pdf.getPage(pageNumber);
        const pageViewport = page.getViewport({
          scale: renderScale(page.getViewport({ scale: 1 })),
        });

        let canvas = canvasRef.current;
        for (let i = 0; i < 20 && !canvas; i += 1) {
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
          if (cancelled) return;
          canvas = canvasRef.current;
        }
        if (!canvas) throw new Error("no canvas");
        canvas.width = pageViewport.width;
        canvas.height = pageViewport.height;
        setNatural({ w: pageViewport.width, h: pageViewport.height });

        const task = page.render({ canvas, viewport: pageViewport });
        renderTask = task;
        await task.promise;
        if (cancelled) return;

        const content = await page.getTextContent();
        if (cancelled) return;
        const items = content.items as Array<{
          str?: string;
          transform?: number[];
          width?: number;
        }>;
        textContentRef.current = { items, viewport: pageViewport };
        const height = legibleTextHeight(items, pageViewport.transform);
        setLegibleTextPx(height);
        setWidestLine(
          widestLinePx(items, pageViewport.transform, height * 0.85, pageViewport.width),
        );

        if (!cancelled) setLoading(false);
      } catch (err) {
        if (cancelled || isAbort(err)) return;
        const detail = err instanceof Error ? err.message : String(err ?? "unknown");
        console.error("[PdfPage]", detail, err);
        setError(`Не удалось показать страницу (${detail})`);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        /* ignore */
      }
    };
  }, [url, pageNumber]);

  useEffect(() => {
    return () => {
      const prev = pdfDocRef.current;
      pdfDocRef.current = null;
      void prev?.pdf?.destroy?.().catch(() => {});
    };
  }, [url]);

  useEffect(() => {
    const stored = textContentRef.current;
    if (highlightQuery.trim().length < 2) {
      setSearchHits([]);
      onHighlightHits?.(0);
      return;
    }
    if (!stored) {
      setSearchHits([]);
      return;
    }
    const { items, viewport: pageViewport } = stored;
    const vt = pageViewport.transform;
    const viewportScale =
      (pageViewport as { scale?: number }).scale || Math.hypot(vt[0], vt[1]) || 1;
    const layer = items.flatMap((item) => {
      if (!item.str) return [];
      const t = item.transform;
      if (!t) return [];
      const c = vt[0] * t[2] + vt[2] * t[3];
      const d = vt[1] * t[2] + vt[3] * t[3];
      const e = vt[0] * t[4] + vt[2] * t[5] + vt[4];
      const f = vt[1] * t[4] + vt[3] * t[5] + vt[5];
      const fontHeight = Math.max(1, Math.hypot(c, d));
      const width = Math.max(1, (item.width ?? 0) * viewportScale);
      return [
        {
          text: item.str,
          x: e / pageViewport.width,
          y: (f - fontHeight) / pageViewport.height,
          w: Math.max(0.01, width / pageViewport.width),
          h: Math.max(0.01, fontHeight / pageViewport.height),
        },
      ];
    });
    const hits = hitsInsideRegion(
      findLayerHits(layer, highlightQuery),
      remarkFocus ? highlightRegion : null,
    );
    setSearchHits(hits);
    onHighlightHits?.(hits.length);
  }, [
    highlightQuery,
    highlightNonce,
    highlightRegion,
    loading,
    pageNumber,
    onHighlightHits,
    remarkFocus,
  ]);

  useEffect(() => {
    if (!markMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDraw(null);
      onCancelMark?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markMode, onCancelMark]);

  const finishDraw = useCallback(
    (state: DrawState) => {
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
    },
    [onMarkRect],
  );

  /**
   * Рамку ведём на окне: курсор ушёл за край листа или на панель — обводка не
   * сбрасывается, точка прижимается к краю (созвон 18.09).
   */
  useEffect(() => {
    if (!draw && !zoomBox) return;
    const move = (event: MouseEvent) => {
      const point = viewport.toPagePoint(event.clientX, event.clientY);
      if (draw) setDraw({ ...draw, x1: point.x, y1: point.y });
      else if (zoomBox) setZoomBox({ ...zoomBox, x1: point.x, y1: point.y });
    };
    const up = () => {
      if (draw) {
        finishDraw(draw);
        setDraw(null);
        return;
      }
      if (!zoomBox) return;
      const rect = {
        x: Math.min(zoomBox.x0, zoomBox.x1),
        y: Math.min(zoomBox.y0, zoomBox.y1),
        w: Math.abs(zoomBox.x1 - zoomBox.x0),
        h: Math.abs(zoomBox.y1 - zoomBox.y0),
      };
      setZoomBox(null);
      if (rect.w > 0.01 && rect.h > 0.01) viewport.zoomToRect(rect);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [draw, zoomBox, viewport, finishDraw]);

  const preview = markMode && draw
    ? {
        x: Math.min(draw.x0, draw.x1),
        y: Math.min(draw.y0, draw.y1),
        w: Math.abs(draw.x1 - draw.x0),
        h: Math.abs(draw.y1 - draw.y0),
      }
    : zoomBox
      ? {
          x: Math.min(zoomBox.x0, zoomBox.x1),
          y: Math.min(zoomBox.y0, zoomBox.y1),
          w: Math.abs(zoomBox.x1 - zoomBox.x0),
          h: Math.abs(zoomBox.y1 - zoomBox.y0),
        }
      : null;

  const cursor = markMode
    ? "cursor-crosshair"
    : zoomBox || viewport.spaceHeld
      ? "cursor-crosshair"
      : viewport.grabbing
        ? "cursor-grabbing"
        : viewport.canPan
          ? "cursor-grab"
          : "cursor-default";

  return (
    <div className="group relative flex h-full min-h-0 flex-col">
      <div
        ref={wrapRef}
        tabIndex={0}
        data-viewer-wrap=""
        className={`relative min-h-0 flex-1 overflow-hidden bg-[#f7f8fa] outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${cursor}`}
        onWheel={(event) => event.preventDefault()}
        onDoubleClick={(event) => {
          if (markMode) return;
          if (event.shiftKey) viewport.setScalePercent(100);
          else viewport.fit("page");
        }}
        onKeyDown={(event) => {
          const step = 64;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            viewport.panBy(step, 0);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            viewport.panBy(-step, 0);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            viewport.panBy(0, step);
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            viewport.panBy(0, -step);
          }
        }}
        onMouseDown={(event) => {
          if (event.button === 1 || viewport.spaceHeld) {
            event.preventDefault();
            viewport.startPan(event.clientX, event.clientY);
            return;
          }
          if (event.button !== 0) return;
          if (markMode) {
            const point = viewport.toPagePoint(event.clientX, event.clientY);
            setDraw({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
            return;
          }
          if (event.shiftKey) {
            const point = viewport.toPagePoint(event.clientX, event.clientY);
            setZoomBox({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
            return;
          }
          viewport.startPan(event.clientX, event.clientY);
        }}
        onMouseMove={(event) => {
          // Рамку и зум-рамку ведёт слушатель окна: он не теряет курсор за краем.
          if (markMode || draw || zoomBox) return;
          if (viewport.movePan(event.clientX, event.clientY)) return;
          if (onHoverRegion && hoverRegions.length) {
            const point = viewport.toPagePoint(event.clientX, event.clientY);
            const hit = regionAtPoint(hoverRegions, point.x, point.y);
            onHoverRegion(hit?.id ?? null);
          }
        }}
        onMouseUp={(event) => {
          if (markMode || draw || zoomBox) return;
          const wasClick = viewport.endPan();
          if (wasClick && onSelectRegion && hoverRegions.length) {
            const point = viewport.toPagePoint(event.clientX, event.clientY);
            const hit = regionAtPoint(hoverRegions, point.x, point.y);
            onSelectRegion(hit?.id ?? null);
          }
        }}
        onMouseLeave={() => {
          if (draw || zoomBox) return;
          viewport.endPan();
          onHoverRegion?.(null);
        }}
      >
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-[#8b93a3]">
            Страница загружается…
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-0 z-20 flex flex-col bg-white">
            <div
              data-pdf-error={error}
              className="shrink-0 border-b border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
            >
              {error}
            </div>
            <iframe
              title="PDF"
              src={`${url}#page=${pageNumber}`}
              className="h-full w-full flex-1 border-0 bg-white"
            />
          </div>
        ) : (
          <div
            className="absolute left-0 top-0 origin-top-left overflow-hidden"
            style={{
              width: natural.w,
              height: natural.h,
              transform: `translate(${viewport.pan.x}px, ${viewport.pan.y}px) scale(${viewport.scale})`,
            }}
          >
            <canvas
              ref={canvasRef}
              className="block bg-white shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
            />
            {highlightRegion ? (
              <div
                className="pointer-events-none absolute z-[5] bg-emerald-400/35 outline outline-2 outline-emerald-600 shadow-[0_0_0_4px_rgba(16,185,129,0.2)]"
                style={{
                  left: `${highlightRegion.x * 100}%`,
                  top: `${highlightRegion.y * 100}%`,
                  width: `${Math.max(2.5, highlightRegion.w * 100)}%`,
                  height: `${Math.max(1.5, highlightRegion.h * 100)}%`,
                }}
              />
            ) : null}
            {highlightRegions.map((region) => (
              <div
                key={region.id}
                className="pointer-events-none absolute z-[5] bg-sky-400/25 outline outline-2 outline-sky-600"
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${Math.max(2.5, region.w * 100)}%`,
                  height: `${Math.max(1.5, region.h * 100)}%`,
                }}
              />
            ))}
            {searchHits.map((hit, index) => (
              <div
                key={`q-${index}`}
                className={
                  remarkFocus
                    ? "pointer-events-none absolute z-[7] pto-remark-zone"
                    : index === hitFocus.index
                      ? "pointer-events-none absolute z-[7] bg-amber-300/60 outline outline-2 outline-amber-600"
                      : "pointer-events-none absolute bg-amber-300/45 outline outline-1 outline-amber-500/80"
                }
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
                    borderWidth: Math.max(1, 2 / viewport.scale),
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
                      padding: `${1 / viewport.scale}px ${4 / viewport.scale}px`,
                      borderRadius: 3 / viewport.scale,
                      fontSize: Math.max(6, 13 / viewport.scale),
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
                data-mark-preview=""
                className="pointer-events-none absolute"
                style={{
                  left: `${preview.x * 100}%`,
                  top: `${preview.y * 100}%`,
                  width: `${preview.w * 100}%`,
                  height: `${preview.h * 100}%`,
                  border: `${Math.max(1, 2 / viewport.scale)}px ${
                    zoomBox ? "solid #2563eb" : "dashed #dc2626"
                  }`,
                  background: zoomBox ? "rgba(37,99,235,0.1)" : "rgba(220,38,38,0.1)",
                }}
              />
            ) : null}
          </div>
        )}
      </div>

      {markMode || searchHits.length > 0 || legendOn || overlay ? (
        <div className="pointer-events-none absolute left-2 top-11 z-20 flex max-w-[calc(100%-0.75rem)] flex-wrap items-center gap-1">
          {markMode ? (
            <span className="rounded bg-red-600 px-2 py-0.5 pto-t-sm font-medium leading-none text-white shadow-md">
              Обведите место на чертеже · Esc — отмена
            </span>
          ) : null}
          <SearchHitBadge
            count={hitFocus.count}
            index={hitFocus.index}
            onStep={hitFocus.step}
          />
          {overlay}
          {legendOn ? (
            <HighlightLegend
              hasZone={Boolean(highlightRegion)}
              hasHits={searchHits.length > 0}
              hasSiblings={highlightRegions.length > 0}
            />
          ) : null}
        </div>
      ) : null}

      <ViewerStatusBar
        hint={hintOn ? VIEWER_MOUSE_HINT : null}
        legibleWarning={legibleWarning}
        onLegible={() => viewport.fit("legible")}
        onDismissHint={() => {
          saveViewerPrefs({ ...loadViewerPrefs(), hintDismissed: true });
          setHintOn(false);
        }}
        nav={
          <ViewerSheetControls
            scale={viewport.scale}
            fitMode={viewport.fitMode}
            onFit={viewport.fit}
            onZoomBy={viewport.zoomBy}
            onSetPercent={viewport.setScalePercent}
            onPrevPage={onPrevPage}
            onNextPage={onNextPage}
            canPrevPage={canPrevPage}
            canNextPage={canNextPage}
            hasLegible={viewport.legibleScale > 0}
            menuUp
          />
        }
      />

      <ViewerToolbar
        onToggleFullscreen={onToggleFullscreen}
        fullscreenActive={fullscreenActive}
        leading={toolbarLeading}
      />
    </div>
  );
}
