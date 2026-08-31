"use client";

import { useEffect, useRef, useState } from "react";
import { SegmentedTabs } from "@/components/ui-chrome";
import {
  regionAtPoint,
  type PageTextRegion,
} from "@/lib/content-sync";
import { clampPan } from "@/lib/page-viewport";
import { getPageView, setPageView } from "@/lib/review-view-cache";
import type { AnnotationRect, PageAnnotation } from "@/types";

type PdfPageProps = {
  url: string;
  pageNumber: number;
  /** Ключ кэша вида между монтированиями (обычно document.id). */
  viewCacheKey?: string;
  annotations?: PageAnnotation[];
  markMode?: boolean;
  activeAnnotationId?: string | null;
  /** Смена значения — сброс вида и короткая вспышка «якорь». */
  highlightNonce?: number;
  /** Подсветка совпадений поиска на чертеже (текст PDF). */
  highlightQuery?: string;
  /** Зона под курсором / hover с расшифровки. */
  highlightRegion?: PageTextRegion | null;
  /** При наведении с текста — подтянуть участок в кадр. */
  panToHighlight?: boolean;
  /** Зоны для hit-test при наведении / клике. */
  hoverRegions?: PageTextRegion[];
  onHoverRegion?: (regionId: string | null) => void;
  /** Клик по фрагменту (режим подсветки). */
  onSelectRegion?: (regionId: string | null) => void;
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
  viewCacheKey,
  annotations = [],
  markMode = false,
  activeAnnotationId = null,
  highlightNonce = 0,
  highlightQuery = "",
  highlightRegion = null,
  panToHighlight = false,
  hoverRegions = [],
  onHoverRegion,
  onSelectRegion,
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
  const fitModeRef = useRef<"page" | "width">("page");
  const pageRef = useRef(pageNumber);
  const viewCacheRef = useRef(
    new Map<number, { scale: number; pan: { x: number; y: number }; fitMode: "page" | "width" }>(),
  );
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
  const clickRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<{ url: string; pdf: any } | null>(null);
  const textContentRef = useRef<{
    items: Array<{ str?: string; transform?: number[]; width?: number }>;
    viewport: { width: number; height: number; transform: number[] };
  } | null>(null);

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
    fitModeRef.current = fitMode;
  }, [fitMode]);

  useEffect(() => {
    const prev = pageRef.current;
    if (prev !== pageNumber) {
      const snap = {
        scale: scaleRef.current,
        pan: { ...panRef.current },
        fitMode: fitModeRef.current,
      };
      viewCacheRef.current.set(prev, snap);
      if (viewCacheKey) setPageView(viewCacheKey, prev, snap);
      pageRef.current = pageNumber;
    }
  }, [pageNumber, viewCacheKey]);

  useEffect(() => {
    return () => {
      if (!viewCacheKey) return;
      setPageView(viewCacheKey, pageRef.current, {
        scale: scaleRef.current,
        pan: { ...panRef.current },
        fitMode: fitModeRef.current,
      });
    };
  }, [viewCacheKey]);

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
        const viewport = page.getViewport({ scale: 2 });

        let canvas = canvasRef.current;
        for (let i = 0; i < 20 && !canvas; i += 1) {
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
          if (cancelled) return;
          canvas = canvasRef.current;
        }
        if (!canvas) throw new Error("no canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        setNatural({ w: viewport.width, h: viewport.height });

        const task = page.render({
          canvas,
          viewport,
        });
        renderTask = task;
        await task.promise;
        if (cancelled) return;

        const content = await page.getTextContent();
        if (cancelled) return;
        textContentRef.current = {
          items: content.items as Array<{ str?: string; transform?: number[]; width?: number }>,
          viewport,
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
    const needle = highlightQuery.trim().toLowerCase();
    if (!stored || needle.length < 2) {
      setSearchHits([]);
      return;
    }
    const { items, viewport } = stored;
    const hits: TextHit[] = [];
    const vt = viewport.transform;
    for (const item of items) {
      if (!item.str) continue;
      if (!item.str.toLowerCase().includes(needle)) continue;
      const t = item.transform;
      if (!t) continue;
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
    setSearchHits(hits);
  }, [highlightQuery, loading, pageNumber]);

  function boundPan(next: { x: number; y: number }, s = scaleRef.current) {
    const wrap = wrapRef.current;
    const n = naturalRef.current;
    if (!wrap) return next;
    return clampPan(next, {
      viewW: wrap.clientWidth,
      viewH: wrap.clientHeight,
      contentW: n.w * s,
      contentH: n.h * s,
    });
  }

  function fit(mode: "page" | "width") {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const pad = 16;
    const scaleW = (wrap.clientWidth - pad) / natural.w;
    const scaleH = (wrap.clientHeight - pad) / natural.h;
    const next = mode === "width" ? scaleW : Math.min(scaleW, scaleH);
    const s = Math.max(0.15, next);
    const contentW = natural.w * s;
    const contentH = natural.h * s;
    setFitMode(mode);
    setScale(s);
    setPan(
      clampPan(
        {
          x: Math.max(pad / 2, (wrap.clientWidth - contentW) / 2),
          y: Math.max(pad / 2, (wrap.clientHeight - contentH) / 2),
        },
        {
          viewW: wrap.clientWidth,
          viewH: wrap.clientHeight,
          contentW,
          contentH,
        },
      ),
    );
  }

  useEffect(() => {
    if (loading || error) return;
    const cached =
      viewCacheRef.current.get(pageNumber) ??
      (viewCacheKey ? getPageView(viewCacheKey, pageNumber) : undefined);
    if (cached) {
      viewCacheRef.current.set(pageNumber, cached);
      setFitMode(cached.fitMode);
      setScale(cached.scale);
      scaleRef.current = cached.scale;
      const wrap = wrapRef.current;
      const clamped = wrap
        ? clampPan(cached.pan, {
            viewW: wrap.clientWidth,
            viewH: wrap.clientHeight,
            contentW: natural.w * cached.scale,
            contentH: natural.h * cached.scale,
          })
        : cached.pan;
      panRef.current = clamped;
      setPan(clamped);
      return;
    }
    fit("width");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, natural.w, natural.h, pageNumber, viewCacheKey]);

  useEffect(() => {
    if (!highlightNonce) return;
    fit("page");
    setAnchorFlash(true);
    const timer = window.setTimeout(() => setAnchorFlash(false), 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightNonce]);

  useEffect(() => {
    if (!panToHighlight || !highlightRegion) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const s = scaleRef.current;
    const p = panRef.current;
    const n = naturalRef.current;
    const cx = (highlightRegion.x + highlightRegion.w / 2) * n.w * s + p.x;
    const cy = (highlightRegion.y + highlightRegion.h / 2) * n.h * s + p.y;
    const margin = 48;
    let nx = p.x;
    let ny = p.y;
    if (cx < margin) nx += margin - cx;
    else if (cx > wrap.clientWidth - margin) nx -= cx - (wrap.clientWidth - margin);
    if (cy < margin) ny += margin - cy;
    else if (cy > wrap.clientHeight - margin) ny -= cy - (wrap.clientHeight - margin);
    if (nx === p.x && ny === p.y) return;
    applyingSync.current = true;
    const next = boundPan({ x: nx, y: ny });
    panRef.current = next;
    setPan(next);
    requestAnimationFrame(() => {
      applyingSync.current = false;
    });
  }, [highlightRegion, panToHighlight, scale, natural.w, natural.h]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      if (!event.ctrlKey) {
        const next = boundPan({
          ...panRef.current,
          y: panRef.current.y - event.deltaY,
        });
        panRef.current = next;
        setPan(next);
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
      const nextPan = boundPan(
        {
          x: cx - contentX * nextScale,
          y: cy - contentY * nextScale,
        },
        nextScale,
      );
      scaleRef.current = nextScale;
      panRef.current = nextPan;
      setScale(nextScale);
      setPan(nextPan);
    };
    wrap.addEventListener("wheel", onWheelNative, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheelNative);
  }, [natural.h]);

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
          clickRef.current = { x: event.clientX, y: event.clientY, moved: false };
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
          if (drag) {
            if (
              clickRef.current &&
              (Math.abs(event.clientX - clickRef.current.x) > 4 ||
                Math.abs(event.clientY - clickRef.current.y) > 4)
            ) {
              clickRef.current.moved = true;
            }
            const next = boundPan({
              x: drag.panX + (event.clientX - drag.x),
              y: drag.panY + (event.clientY - drag.y),
            });
            panRef.current = next;
            setPan(next);
            return;
          }
          if (onHoverRegion && hoverRegions.length) {
            const point = toPagePoint(event.clientX, event.clientY);
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
          const wasClick = clickRef.current && !clickRef.current.moved;
          dragRef.current = null;
          setGrabbing(false);
          clickRef.current = null;
          if (wasClick && onSelectRegion && hoverRegions.length) {
            const point = toPagePoint(event.clientX, event.clientY);
            const hit = regionAtPoint(hoverRegions, point.x, point.y);
            onSelectRegion(hit?.id ?? null);
          }
        }}
        onMouseLeave={() => {
          dragRef.current = null;
          setGrabbing(false);
          setDraw(null);
          clickRef.current = null;
          onHoverRegion?.(null);
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
          {Math.round(scale * 100)}%
        </span>
      </div>
    </div>
  );
}
