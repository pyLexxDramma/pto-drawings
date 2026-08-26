"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SegmentedTabs, Spinner } from "@/components/ui-chrome";
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
  panYForAnchor,
  regionAtPoint,
  regionsFromCadTexts,
  visibleAnchorY,
  type PageTextRegion,
} from "@/lib/content-sync";
import type { AnnotationRect, PageAnnotation } from "@/types";

type CadPageProps = {
  documentId: string;
  pageNumber: number;
  annotations?: PageAnnotation[];
  markMode?: boolean;
  activeAnnotationId?: string | null;
  highlightNonce?: number;
  highlightQuery?: string;
  scrollSync?: boolean;
  scrollRatio?: number | null;
  scrollAnchorY?: number | null;
  highlightAnchorY?: number | null;
  highlightRegion?: PageTextRegion | null;
  panToHighlight?: boolean;
  hoverRegions?: PageTextRegion[];
  onScrollRatioChange?: (ratio: number) => void;
  onScrollAnchorChange?: (y: number) => void;
  onTextRegionsReady?: (regions: PageTextRegion[]) => void;
  onHoverRegion?: (regionId: string | null) => void;
  onSelectRegion?: (regionId: string | null) => void;
  onMarkRect?: (rect: AnnotationRect) => void;
  onSelectAnnotation?: (id: string) => void;
  onCancelMark?: () => void;
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
  scrollSync = false,
  scrollRatio = null,
  scrollAnchorY = null,
  highlightAnchorY = null,
  highlightRegion = null,
  panToHighlight = false,
  hoverRegions = [],
  onScrollRatioChange,
  onScrollAnchorChange,
  onTextRegionsReady,
  onHoverRegion,
  onSelectRegion,
  onMarkRect,
  onSelectAnnotation,
  onCancelMark,
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

  function emitScrollPosition(nextPan: { x: number; y: number }, nextScale = scale) {
    if (applyingSync.current) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const pad = 8;
    if (onScrollAnchorChange) {
      onScrollAnchorChange(
        visibleAnchorY(nextPan.y, nextScale, natural.h, wrap.clientHeight, pad),
      );
    }
    if (!onScrollRatioChange) return;
    const contentH = natural.h * nextScale;
    const maxPan = Math.max(1, contentH - wrap.clientHeight);
    const ratio = Math.min(1, Math.max(0, (pad - nextPan.y) / maxPan));
    onScrollRatioChange(ratio);
  }

  useEffect(() => {
    if (loading || error) return;
    if (!geometry && !previewUrl) return;
    const cached = viewCacheRef.current.get(pageNumber);
    if (cached) {
      setFitMode(cached.fitMode);
      setScale(cached.scale);
      setPan(cached.pan);
      return;
    }
    fit("page");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, natural.w, natural.h, pageNumber, geometry, previewUrl]);

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
    const next = { x: nx, y: ny };
    panRef.current = next;
    setPan(next);
    requestAnimationFrame(() => {
      applyingSync.current = false;
    });
  }, [highlightRegion, panToHighlight, scale, natural.w, natural.h]);

  useEffect(() => {
    if (!scrollSync) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    applyingSync.current = true;
    const pad = 8;
    if (scrollAnchorY != null) {
      setPan((prev) => ({
        ...prev,
        y: panYForAnchor(scrollAnchorY, scale, natural.h, wrap.clientHeight, pad),
      }));
    } else if (scrollRatio != null) {
      const contentH = natural.h * scale;
      const maxPan = Math.max(0, contentH - wrap.clientHeight);
      setPan((prev) => ({
        ...prev,
        y: pad - scrollRatio * maxPan,
      }));
    } else {
      applyingSync.current = false;
      return;
    }
    requestAnimationFrame(() => {
      applyingSync.current = false;
    });
  }, [
    scrollRatio,
    scrollAnchorY,
    natural.h,
    scale,
    scrollSync,
    onScrollAnchorChange,
  ]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      if (scrollSync && !event.ctrlKey) {
        const next = {
          ...panRef.current,
          y: panRef.current.y - event.deltaY,
        };
        panRef.current = next;
        setPan(next);
        emitScrollPosition(next, scaleRef.current);
        return;
      }
      const oldScale = scaleRef.current;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextScale = Math.min(12, Math.max(0.15, oldScale * factor));
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
      emitScrollPosition(nextPan, nextScale);
    };
    wrap.addEventListener("wheel", onWheelNative, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheelNative);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScrollRatioChange, onScrollAnchorChange, natural.h, scrollSync]);

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

  const needle = highlightQuery.trim().toLowerCase();
  const searchHits = useMemo(() => {
    if (!geometry || needle.length < 2) return [];
    const hits: { x: number; y: number; w: number; h: number }[] = [];
    const size = bboxSize(geometry.bbox);
    for (const t of texts) {
      if (!t.text?.toLowerCase().includes(needle)) continue;
      if (t.points.length < 2) continue;
      const origin = sheetToNorm(t.points[0], t.points[1], geometry.bbox);
      const th = Math.max(0.008, (t.size ?? 2.5) / size.h);
      const tw = Math.max(
        0.02,
        (t.width ?? (t.text.length * (t.size ?? 2.5) * 0.6)) / size.w,
      );
      hits.push({
        x: Math.max(0, origin.x - (t.anchor === "center" ? tw / 2 : t.anchor === "right" ? tw : 0)),
        y: Math.max(0, origin.y - th * 0.85),
        w: Math.min(1 - origin.x + tw, tw),
        h: th * cadTextLines(t.text).length,
      });
    }
    return hits;
  }, [geometry, needle, texts]);

  useEffect(() => {
    if (!geometry) return;
    onTextRegionsReady?.(regionsFromCadTexts(texts, geometry.bbox));
  }, [geometry, texts, onTextRegionsReady]);

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
            const next = {
              x: drag.panX + (event.clientX - drag.x),
              y: drag.panY + (event.clientY - drag.y),
            };
            panRef.current = next;
            setPan(next);
            emitScrollPosition(next);
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
                    needle.length >= 2 &&
                    t.text.toLowerCase().includes(needle);
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

            {highlightAnchorY != null && !highlightRegion ? (
              <div
                className="pointer-events-none absolute left-0 right-0 border-y-2 border-sky-500/90 bg-sky-400/15"
                style={{
                  top: `${Math.max(0, highlightAnchorY * 100 - 1.5)}%`,
                  height: "3%",
                }}
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
        ) : null}
      </div>

      {markMode ? (
        <div className="pointer-events-none absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-1.5">
          <span className="rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white shadow-md">
            Обведите место на чертеже · Esc — отмена
          </span>
        </div>
      ) : null}

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
          {geometry?.scale ? ` · ${geometry.scale}` : ""}
        </span>
      </div>
    </div>
  );
}

// keep type export for callers that may need bbox helpers later
export type { CadBBox };
