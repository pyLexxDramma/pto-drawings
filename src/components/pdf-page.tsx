"use client";

import { useEffect, useRef, useState } from "react";
import { ViewerHint } from "@/components/viewer-hint";
import { ViewerMinimap } from "@/components/viewer-minimap";
import { ViewerToolbar } from "@/components/viewer-toolbar";
import { usePageViewport } from "@/hooks/use-page-viewport";
import {
  regionAtPoint,
  type PageTextRegion,
} from "@/lib/content-sync";
import { findLayerHits } from "@/lib/highlight-text";
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
};

type DrawState = { x0: number; y0: number; x1: number; y1: number };
type TextHit = { x: number; y: number; w: number; h: number };

const MIN_SIDE = 0.012;

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
}: PdfPageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [natural, setNatural] = useState({ w: 800, h: 1100 });
  const [draw, setDraw] = useState<DrawState | null>(null);
  const [zoomBox, setZoomBox] = useState<DrawState | null>(null);
  const [searchHits, setSearchHits] = useState<TextHit[]>([]);
  const [hintOn, setHintOn] = useState(() => shouldShowViewerHint(loadViewerPrefs()));
  const [minimapOn, setMinimapOn] = useState(() => loadViewerPrefs().minimap);
  const [wrapSize, setWrapSize] = useState({ w: 0, h: 0 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<{ url: string; pdf: any } | null>(null);
  const textContentRef = useRef<{
    items: Array<{ str?: string; transform?: number[]; width?: number }>;
    viewport: { width: number; height: number; transform: number[] };
  } | null>(null);

  const ready = !loading && !error;
  const viewport = usePageViewport({
    wrapRef,
    natural,
    pageNumber,
    ready,
    viewCacheKey,
    highlightNonce,
    highlightRegion,
    panToHighlight,
    wheelMode: "pan",
    onUserZoom: () => {
      const prefs = loadViewerPrefs();
      if (!prefs.hintDismissed) {
        saveViewerPrefs({ ...prefs, hintDismissed: true });
        setHintOn(false);
      }
    },
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      setWrapSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    });
    ro.observe(wrap);
    setWrapSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    return () => ro.disconnect();
  }, []);

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
        const pageViewport = page.getViewport({ scale: 2 });

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

        const mini = miniRef.current;
        if (mini) {
          const thumb = page.getViewport({ scale: 0.18 });
          mini.width = thumb.width;
          mini.height = thumb.height;
          await page.render({ canvas: mini, viewport: thumb }).promise;
        }

        const content = await page.getTextContent();
        if (cancelled) return;
        textContentRef.current = {
          items: content.items as Array<{ str?: string; transform?: number[]; width?: number }>,
          viewport: pageViewport,
        };

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
    if (!stored || highlightQuery.trim().length < 2) {
      setSearchHits([]);
      onHighlightHits?.(0);
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
    const hits = findLayerHits(layer, highlightQuery);
    setSearchHits(hits);
    onHighlightHits?.(hits.length);
  }, [highlightQuery, highlightNonce, loading, pageNumber, onHighlightHits]);

  useEffect(() => {
    if (!markMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelMark?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markMode, onCancelMark]);

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
          if (markMode) {
            if (!draw) return;
            const point = viewport.toPagePoint(event.clientX, event.clientY);
            setDraw({ ...draw, x1: point.x, y1: point.y });
            return;
          }
          if (zoomBox) {
            const point = viewport.toPagePoint(event.clientX, event.clientY);
            setZoomBox({ ...zoomBox, x1: point.x, y1: point.y });
            return;
          }
          if (viewport.movePan(event.clientX, event.clientY)) return;
          if (onHoverRegion && hoverRegions.length) {
            const point = viewport.toPagePoint(event.clientX, event.clientY);
            const hit = regionAtPoint(hoverRegions, point.x, point.y);
            onHoverRegion(hit?.id ?? null);
          }
        }}
        onMouseUp={(event) => {
          if (markMode) {
            if (draw) finishDraw(draw);
            setDraw(null);
            return;
          }
          if (zoomBox) {
            const rect = {
              x: Math.min(zoomBox.x0, zoomBox.x1),
              y: Math.min(zoomBox.y0, zoomBox.y1),
              w: Math.abs(zoomBox.x1 - zoomBox.x0),
              h: Math.abs(zoomBox.y1 - zoomBox.y0),
            };
            setZoomBox(null);
            if (rect.w > 0.01 && rect.h > 0.01) viewport.zoomToRect(rect);
            return;
          }
          const wasClick = viewport.endPan();
          if (wasClick && onSelectRegion && hoverRegions.length) {
            const point = viewport.toPagePoint(event.clientX, event.clientY);
            const hit = regionAtPoint(hoverRegions, point.x, point.y);
            onSelectRegion(hit?.id ?? null);
          }
        }}
        onMouseLeave={() => {
          viewport.endPan();
          setDraw(null);
          setZoomBox(null);
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
            {searchHits.map((hit, index) => (
              <div
                key={`q-${index}`}
                className={
                  remarkFocus
                    ? "pointer-events-none absolute z-[7] pto-remark-zone"
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
      ) : (
        <ViewerHint show={hintOn} wheelMode="pan" />
      )}

      <ViewerMinimap
        natural={natural}
        scale={viewport.scale}
        pan={viewport.pan}
        viewW={wrapSize.w}
        viewH={wrapSize.h}
        visible={
          minimapOn &&
          ready &&
          viewport.scale > viewport.fitScale * 1.2
        }
        onJump={viewport.jumpToPagePoint}
      >
        <canvas ref={miniRef} className="h-full w-full object-contain" />
      </ViewerMinimap>

      <ViewerToolbar
        scale={viewport.scale}
        fitMode={viewport.fitMode}
        onFit={viewport.fit}
        onZoomBy={viewport.zoomBy}
        onSetPercent={viewport.setScalePercent}
        onPrevPage={onPrevPage}
        onNextPage={onNextPage}
        canPrevPage={canPrevPage}
        canNextPage={canNextPage}
        onToggleFullscreen={onToggleFullscreen}
        fullscreenActive={fullscreenActive}
        extra={
          <button
            type="button"
            title={minimapOn ? "Скрыть обзор листа" : "Показать обзор листа"}
            onClick={() => {
              const next = !minimapOn;
              setMinimapOn(next);
              saveViewerPrefs({ ...loadViewerPrefs(), minimap: next });
            }}
            className={`pto-tool hidden rounded border px-1.5 text-[10px] sm:inline ${
              minimapOn
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border bg-white text-muted"
            }`}
          >
            Обзор
          </button>
        }
      />
    </div>
  );
}
