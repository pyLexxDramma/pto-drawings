"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/ui-chrome";
import {
  bboxSize,
  cadTextLines,
  groupStrokePaths,
  parseGeometry,
  sheetToNorm,
  type CadBBox,
  type CadGeometry,
  type CadPrimitive,
} from "@/lib/cad-geometry";
import {
  regionAtPoint,
  type PageTextRegion,
} from "@/lib/content-sync";
import { findLayerHits, highlightNeedles } from "@/lib/highlight-text";
import { normalizeQuote } from "@/lib/remark-jump";
import { clampPan } from "@/lib/page-viewport";
import type { AnnotationRect, PageAnnotation } from "@/types";

type CadPageProps = {
  documentId: string;
  pageNumber: number;
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
};

type DrawState = { x0: number; y0: number; x1: number; y1: number };

const MIN_SIDE = 0.012;

function textAnchor(anchor: string | undefined) {
  if (anchor === "center") return "middle";
  if (anchor === "right") return "end";
  return "start";
}

function dominantBaseline(valign: string | undefined) {
  if (valign === "top") return "text-before-edge";
  if (valign === "middle") return "middle";
  if (valign === "bottom") return "text-after-edge";
  return "alphabetic";
}

export function CadPage({
  documentId,
  pageNumber,
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
}: CadPageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const clickRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
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
    new Map<
      number,
      { scale: number; pan: { x: number; y: number }; fitMode: "page" | "width" }
    >(),
  );

  const [geometry, setGeometry] = useState<CadGeometry | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [natural, setNatural] = useState({ w: 800, h: 1100 });
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [grabbing, setGrabbing] = useState(false);
  const [draw, setDraw] = useState<DrawState | null>(null);
  const [anchorFlash, setAnchorFlash] = useState(false);
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
    fitModeRef.current = fitMode;
  }, [fitMode]);

  useEffect(() => {
    const prev = pageRef.current;
    if (prev !== pageNumber) {
      viewCacheRef.current.set(prev, {
        scale: scaleRef.current,
        pan: { ...panRef.current },
        fitMode: fitModeRef.current,
      });
      pageRef.current = pageNumber;
    }
  }, [pageNumber]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      setLoading(true);
      setError(null);
      setGeometry(null);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });

      try {
        const response = await fetch(
          `/api/documents/${documentId}/pages/${pageNumber}/geometry`,
        );
        if (response.ok) {
          const csv = await response.text();
          if (cancelled) return;
          const parsed = parseGeometry(csv);
          const size = bboxSize(parsed.bbox);
          // ~3.5 px/mm — читаемый масштаб на типичном мониторе.
          const px = 3.5;
          setNatural({
            w: Math.max(320, size.w * px),
            h: Math.max(240, size.h * px),
          });
          setGeometry(parsed);
          setLoading(false);
          return;
        }

        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        // Запасной путь: PNG/SVG превью с конвейера.
        const preview = await fetch(
          `/api/documents/${documentId}/pages/${pageNumber}/preview?format=png`,
        );
        if (preview.ok) {
          const blob = await preview.blob();
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
          setNatural({ w: 900, h: 1200 });
          setError(null);
          setLoading(false);
          return;
        }

        if (cancelled) return;
        setError(
          payload.error ||
            "Геометрия листа недоступна (внешние ссылки или служебный лист)",
        );
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Не удалось загрузить чертёж");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, pageNumber]);

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

  /** Зум к точке в координатах wrap; без якоря — к центру панели (кнопки +/−). */
  function zoomBy(factor: number, anchor?: { x: number; y: number }) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const oldScale = scaleRef.current;
    const nextScale = Math.min(12, Math.max(0.05, oldScale * factor));
    if (nextScale === oldScale) return;
    const cx = anchor?.x ?? wrap.clientWidth / 2;
    const cy = anchor?.y ?? wrap.clientHeight / 2;
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
  }

  function fit(mode: "page" | "width") {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const pad = 16;
    const scaleW = (wrap.clientWidth - pad) / natural.w;
    const scaleH = (wrap.clientHeight - pad) / natural.h;
    const next = mode === "width" ? scaleW : Math.min(scaleW, scaleH);
    const s = Math.max(0.05, next);
    const contentW = natural.w * s;
    const contentH = natural.h * s;
    const nextPan = clampPan(
      {
        x: (wrap.clientWidth - contentW) / 2,
        y: (wrap.clientHeight - contentH) / 2,
      },
      {
        viewW: wrap.clientWidth,
        viewH: wrap.clientHeight,
        contentW,
        contentH,
      },
    );
    fitModeRef.current = mode;
    scaleRef.current = s;
    panRef.current = nextPan;
    setFitMode(mode);
    setScale(s);
    setPan(nextPan);
  }

  useEffect(() => {
    if (loading || error) return;
    if (!geometry && !previewUrl) return;
    const cached = viewCacheRef.current.get(pageNumber);
    if (cached) {
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
  }, [loading, error, natural.w, natural.h, pageNumber, geometry, previewUrl]);

  // Панель проектов / сплит меняют ширину без remount — пересчитываем fit.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || loading || error) return;
    let prevW = wrap.clientWidth;
    let prevH = wrap.clientHeight;
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w < 8 || h < 8) return;
      if (Math.abs(w - prevW) < 2 && Math.abs(h - prevH) < 2) return;
      prevW = w;
      prevH = h;
      fit(fitModeRef.current);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, natural.w, natural.h, pageNumber]);

  useEffect(() => {
    if (!highlightNonce) return;
    if (!panToHighlight) fit("page");
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
      // Ctrl (Win) / Cmd (Mac) + колесо; pinch на трекпаде Mac тоже шлёт ctrlKey.
      const zoomGesture = event.ctrlKey || event.metaKey;
      if (!zoomGesture) {
        // Горизонтальный скролл трекпада и колеса-качалки шлёт deltaX; Shift
        // на обычном колесе тоже даёт горизонталь — иначе чертёж не сдвинуть.
        const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
        const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
        const next = boundPan({
          x: panRef.current.x - dx,
          y: panRef.current.y - dy,
        });
        panRef.current = next;
        setPan(next);
        return;
      }
      const rect = wrap.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomBy(factor, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
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

  const strokeGroups = useMemo(
    () => (geometry ? groupStrokePaths(geometry.primitives) : null),
    [geometry],
  );

  const texts = useMemo(
    () =>
      geometry
        ? geometry.primitives.filter(
            (p): p is CadPrimitive & { type: "text" } => p.type === "text",
          )
        : [],
    [geometry],
  );

  const searchHits = useMemo(() => {
    if (!geometry || highlightQuery.trim().length < 2) return [];
    const size = bboxSize(geometry.bbox);
    const layer = texts.flatMap((t) => {
      if (!t.text || t.points.length < 2) return [];
      const origin = sheetToNorm(t.points[0], t.points[1], geometry.bbox);
      const th = Math.max(0.008, (t.size ?? 2.5) / size.h);
      const tw = Math.max(
        0.02,
        (t.width ?? (t.text.length * (t.size ?? 2.5) * 0.6)) / size.w,
      );
      return [
        {
          text: t.text,
          x: Math.max(0, origin.x - (t.anchor === "center" ? tw / 2 : t.anchor === "right" ? tw : 0)),
          y: Math.max(0, origin.y - th * 0.85),
          w: Math.min(1 - origin.x + tw, tw),
          h: th * cadTextLines(t.text).length,
        },
      ];
    });
    return findLayerHits(layer, highlightQuery);
  }, [geometry, highlightQuery, texts]);

  const needles = useMemo(
    () => highlightNeedles(highlightQuery),
    [highlightQuery],
  );

  useEffect(() => {
    onHighlightHits?.(searchHits.length);
  }, [searchHits.length, onHighlightHits]);

  useEffect(() => {
    if (!panToHighlight || highlightRegion || searchHits.length === 0) return;
    const hit = searchHits[0];
    const wrap = wrapRef.current;
    if (!wrap) return;
    const s = scaleRef.current;
    const p = panRef.current;
    const n = naturalRef.current;
    const cx = (hit.x + hit.w / 2) * n.w * s + p.x;
    const cy = (hit.y + hit.h / 2) * n.h * s + p.y;
    const margin = 64;
    let nx = p.x;
    let ny = p.y;
    if (cx < margin) nx += margin - cx;
    else if (cx > wrap.clientWidth - margin) nx -= cx - (wrap.clientWidth - margin);
    if (cy < margin) ny += margin - cy;
    else if (cy > wrap.clientHeight - margin) ny -= cy - (wrap.clientHeight - margin);
    const targetScale = Math.min(4, Math.max(s, 1.4));
    if (targetScale !== s) {
      const contentX = (cx - p.x) / s;
      const contentY = (cy - p.y) / s;
      const zoomed = boundPan(
        {
          x: wrap.clientWidth / 2 - contentX * targetScale,
          y: wrap.clientHeight / 2 - contentY * targetScale,
        },
        targetScale,
      );
      scaleRef.current = targetScale;
      panRef.current = zoomed;
      setScale(targetScale);
      setPan(zoomed);
      return;
    }
    if (nx === p.x && ny === p.y) return;
    applyingSync.current = true;
    const next = boundPan({ x: nx, y: ny });
    panRef.current = next;
    setPan(next);
    requestAnimationFrame(() => {
      applyingSync.current = false;
    });
  }, [panToHighlight, highlightRegion, searchHits, scale, natural.w, natural.h]);

  const preview = markMode && draw
    ? {
        x: Math.min(draw.x0, draw.x1),
        y: Math.min(draw.y0, draw.y1),
        w: Math.abs(draw.x1 - draw.x0),
        h: Math.abs(draw.y1 - draw.y0),
      }
    : null;

  const cursor = markMode
    ? "cursor-crosshair"
    : grabbing
      ? "cursor-grabbing"
      : "cursor-grab";

  const viewBox = geometry
    ? `${geometry.bbox.x0} ${-geometry.bbox.y1} ${bboxSize(geometry.bbox).w} ${bboxSize(geometry.bbox).h}`
    : "0 0 1 1";

  return (
    <div className="group relative flex h-full min-h-0 flex-col">
      <div
        ref={wrapRef}
        className={`relative min-h-0 flex-1 overflow-hidden bg-[#f7f8fa] ${cursor}`}
        style={{ colorScheme: "only light" }}
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
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-sm text-[#8b93a3]">
            <Spinner className="h-5 w-5 text-sky-700" />
            <span>Загрузка геометрии листа…</span>
            <span className="text-[11px] text-muted">
              первый раз может занять несколько секунд
            </span>
          </div>
        ) : null}
        {anchorFlash ? (
          <div className="pointer-events-none absolute inset-0 z-20 animate-pulse border-4 border-sky-400/80 bg-sky-300/10" />
        ) : null}

        {!loading && error && !previewUrl ? (
          <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="max-w-sm rounded-xl border border-dashed border-slate-300 bg-white px-6 py-8 shadow-sm">
              <div className="text-sm font-semibold text-text">Лист без геометрии</div>
              <div className="mt-2 text-xs leading-relaxed text-muted">{error}</div>
              <div className="mt-3 text-[11px] text-muted">
                Текст расшифровки справа, если конвейер его вернул.
              </div>
            </div>
          </div>
        ) : null}

        {!loading && (geometry || previewUrl) ? (
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: natural.w,
              height: natural.h,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            }}
          >
            {geometry && strokeGroups ? (
              <svg
                viewBox={viewBox}
                width={natural.w}
                height={natural.h}
                className="block bg-white shadow-[0_12px_40px_rgba(0,0,0,0.12)]"
                style={{ colorScheme: "only light" }}
              >
                <g transform="scale(1,-1)">
                  {[...strokeGroups].map(([key, parts]) => {
                    const [color, lw] = key.split("|");
                    return (
                      <path
                        key={key}
                        d={parts.join("")}
                        fill="none"
                        stroke={color}
                        strokeWidth={Number(lw) || 0.25}
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </g>
                {texts.map((t, index) => {
                  if (t.points.length < 2 || !t.text) return null;
                  const x = t.points[0];
                  const y = t.points[1];
                  const lines = cadTextLines(t.text);
                  const size = t.size ?? 2.5;
                  const matched =
                    needles.length > 0 &&
                    needles.some((n) => normalizeQuote(t.text!).includes(n));
                  return (
                    <text
                      key={`t-${index}`}
                      x={0}
                      y={0}
                      transform={`translate(${x} ${-y}) rotate(${-(t.rot ?? 0)})`}
                      fontSize={size}
                      textAnchor={textAnchor(t.anchor)}
                      dominantBaseline={dominantBaseline(t.valign)}
                      fill={matched ? "#b45309" : t.color || "#000000"}
                      style={{
                        fontFamily: "Arial, sans-serif",
                        whiteSpace: "pre",
                      }}
                    >
                      {lines.map((line, lineIndex) => (
                        <tspan
                          key={lineIndex}
                          x={0}
                          dy={lineIndex === 0 ? 0 : size * 1.2}
                        >
                          {line}
                        </tspan>
                      ))}
                    </text>
                  );
                })}
              </svg>
            ) : previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={`Лист ${pageNumber}`}
                className="block bg-white shadow-[0_12px_40px_rgba(0,0,0,0.12)]"
                style={{ width: natural.w, height: natural.h, objectFit: "contain" }}
              />
            ) : null}

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
            {remarkFocus && searchHits.length > 0
              ? (() => {
                  const x0 = Math.min(...searchHits.map((h) => h.x));
                  const y0 = Math.min(...searchHits.map((h) => h.y));
                  const x1 = Math.max(...searchHits.map((h) => h.x + h.w));
                  const y1 = Math.max(...searchHits.map((h) => h.y + h.h));
                  const pad = 0.006;
                  return (
                    <div
                      className="pointer-events-none absolute z-[6] pto-remark-zone"
                      style={{
                        left: `${Math.max(0, x0 - pad) * 100}%`,
                        top: `${Math.max(0, y0 - pad) * 100}%`,
                        width: `${Math.min(1, x1 - x0 + pad * 2) * 100}%`,
                        height: `${Math.min(1, y1 - y0 + pad * 2) * 100}%`,
                      }}
                    />
                  );
                })()
              : null}
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
        ) : null}
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
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="rounded-md border border-slate-200 bg-white/90 px-2 py-1 text-[10px] text-muted shadow-sm">
            тяни мышью · колесо — сдвиг · Ctrl — зум
          </span>
        </div>
      )}

      <div
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute bottom-2 right-2 z-30 flex items-center gap-1.5 rounded-md border-2 border-sky-400 bg-sky-50 px-1.5 py-1 shadow-md backdrop-blur"
      >
        {onPrevPage || onNextPage ? (
          <div className="flex items-center overflow-hidden rounded border border-sky-500 bg-sky-600">
            <button
              type="button"
              title="Предыдущий лист (K / ←)"
              aria-label="Предыдущий лист"
              onClick={() => onPrevPage?.()}
              disabled={!canPrevPage}
              className="inline-flex h-7 w-8 items-center justify-center text-sm font-bold text-white hover:bg-sky-700 disabled:cursor-default disabled:opacity-40"
            >
              ←
            </button>
            <button
              type="button"
              title="Следующий лист (J / → / пробел)"
              aria-label="Следующий лист"
              onClick={() => onNextPage?.()}
              disabled={!canNextPage}
              className="inline-flex h-7 w-8 items-center justify-center border-l border-sky-400 text-sm font-bold text-white hover:bg-sky-700 disabled:cursor-default disabled:opacity-40"
            >
              →
            </button>
          </div>
        ) : null}
        <div
          className={`flex items-center gap-0.5 ${
            onPrevPage || onNextPage ? "border-l border-sky-300 pl-1.5" : ""
          }`}
        >
          <button
            type="button"
            title="Отдалить"
            aria-label="Отдалить"
            onClick={() => zoomBy(1 / 1.25)}
            className="flex h-6 w-6 items-center justify-center rounded text-sm leading-none text-muted hover:bg-bg hover:text-text"
          >
            −
          </button>
          <span className="min-w-[2.75rem] text-center text-[11px] tabular-nums text-muted">
            {Math.round(scale * 100)}%
            {geometry?.scale ? ` · ${geometry.scale}` : ""}
          </span>
          <button
            type="button"
            title="Приблизить"
            aria-label="Приблизить"
            onClick={() => zoomBy(1.25)}
            className="flex h-6 w-6 items-center justify-center rounded text-sm leading-none text-muted hover:bg-bg hover:text-text"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

// keep type export for callers that may need bbox helpers later
export type { CadBBox };
