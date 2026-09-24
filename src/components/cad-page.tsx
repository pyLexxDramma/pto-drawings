"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Spinner } from "@/components/ui-chrome";
import { VIEWER_MOUSE_HINT } from "@/components/viewer-hint";
import { ViewerStatusBar } from "@/components/viewer-status-bar";
import { ViewerSheetControls, ViewerToolbar } from "@/components/viewer-toolbar";
import { LEGIBLE_MIN_PX, usePageViewport } from "@/hooks/use-page-viewport";
import { useSearchHitFocus } from "@/hooks/use-search-hit-focus";
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
import {
  findLayerHits,
  highlightNeedles,
  hitsInsideRegion,
} from "@/lib/highlight-text";
import { normalizeQuote } from "@/lib/remark-jump";
import {
  loadViewerPrefs,
  saveViewerPrefs,
  shouldShowViewerHint,
} from "@/lib/viewer-prefs";
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
  highlightRegions?: PageTextRegion[];
  panToHighlight?: boolean;
  remarkFocus?: boolean;
  hoverRegions?: PageTextRegion[];
  onHoverRegion?: (regionId: string | null) => void;
  onSelectRegion?: (regionId: string | null) => void;
  onHighlightHits?: (count: number, nonce: number) => void;
  onMarkRect?: (rect: AnnotationRect) => void;
  onSelectAnnotation?: (id: string) => void;
  onCancelMark?: () => void;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  canPrevPage?: boolean;
  canNextPage?: boolean;
  onToggleFullscreen?: () => void;
  fullscreenActive?: boolean;
  /** Переключатель PDF / DWG — внутрь тулбара, а не отдельной плашкой. */
  toolbarLeading?: ReactNode;
};

type DrawState = { x0: number; y0: number; x1: number; y1: number };

const MIN_SIDE = 0.012;
const PX_PER_MM = 3.5;

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

function niceLength(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const n = value / exp;
  const nice = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return nice * exp;
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
  toolbarLeading,
}: CadPageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<CadGeometry | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [natural, setNatural] = useState({ w: 800, h: 1100 });
  const [draw, setDraw] = useState<DrawState | null>(null);
  const [zoomBox, setZoomBox] = useState<DrawState | null>(null);
  const [prefs, setPrefs] = useState(() => loadViewerPrefs());
  const [hintOn, setHintOn] = useState(() => shouldShowViewerHint(loadViewerPrefs()));

  const ready = !loading && Boolean(geometry || previewUrl);
  const texts = useMemo(
    () =>
      geometry
        ? geometry.primitives.filter(
            (p): p is CadPrimitive & { type: "text" } => p.type === "text",
          )
        : [],
    [geometry],
  );
  const pageHits = useMemo(() => {
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
  const searchHits = useMemo(
    () => hitsInsideRegion(pageHits, remarkFocus ? highlightRegion : null),
    [pageHits, remarkFocus, highlightRegion],
  );
  /** Медиана высоты подписей листа в px чертежа — по ней считается «Читаемо». */
  const legibleTextPx = useMemo(() => {
    const sizes = texts
      .map((t) => t.size ?? 0)
      .filter((size) => size > 0)
      .sort((a, b) => a - b);
    if (!sizes.length) return 0;
    return sizes[Math.floor(sizes.length / 2)] * PX_PER_MM;
  }, [texts]);
  const focusRegion =
    highlightRegion ??
    (remarkFocus && searchHits[0] ? searchHits[0] : null);
  const viewport = usePageViewport({
    wrapRef,
    natural,
    pageNumber,
    ready,
    legibleTextPx,
    highlightNonce,
    highlightRegion: focusRegion,
    panToHighlight: panToHighlight || remarkFocus,
    wheelMode: "pan",
    onUserZoom: () => {
      const next = loadViewerPrefs();
      if (!next.hintDismissed) {
        saveViewerPrefs({ ...next, hintDismissed: true });
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
  // Лист А1 «по ширине» даёт 13%: подписи в 2px не читаются. Пока масштаб ниже
  // порога, предлагаем перейти на читаемый.
  const legibleWarning =
    ready &&
    viewport.textOnScreenPx > 0 &&
    viewport.textOnScreenPx < LEGIBLE_MIN_PX &&
    viewport.legibleScale > viewport.scale * 1.15
      ? `${Math.round(viewport.scale * 100)}% — подписи не читаются`
      : null;

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
          setNatural({
            w: Math.max(320, size.w * PX_PER_MM),
            h: Math.max(240, size.h * PX_PER_MM),
          });
          setGeometry(parsed);
          setLoading(false);
          return;
        }

        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
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
   * Рамку ведём на окне: курсор ушёл за край чертежа или на панель — обводка не
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

  const strokeGroups = useMemo(
    () => (geometry ? groupStrokePaths(geometry.primitives) : null),
    [geometry],
  );

  const needles = useMemo(
    () => highlightNeedles(highlightQuery),
    [highlightQuery],
  );

  useEffect(() => {
    if (highlightQuery.trim().length < 2) {
      onHighlightHits?.(0, highlightNonce);
      return;
    }
    if (!geometry) return;
    onHighlightHits?.(searchHits.length, highlightNonce);
  }, [searchHits.length, onHighlightHits, highlightQuery, geometry, highlightNonce]);

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
    : zoomBox
      ? "cursor-crosshair"
      : viewport.grabbing
        ? "cursor-grabbing"
        : viewport.canPan
          ? "cursor-grab"
          : "cursor-default";

  const viewBox = geometry
    ? `${geometry.bbox.x0} ${-geometry.bbox.y1} ${bboxSize(geometry.bbox).w} ${bboxSize(geometry.bbox).h}`
    : "0 0 1 1";

  const showStrokes = prefs.textFilter !== "text";
  const showTexts = prefs.textFilter !== "hide";
  const minLabel = 10 / (PX_PER_MM * Math.max(0.05, viewport.scale));
  const scaleBarMm = niceLength(80 / (PX_PER_MM * Math.max(0.05, viewport.scale)));
  const scaleBarPx = scaleBarMm * PX_PER_MM * viewport.scale;
  const scaleBarLabel =
    geometry?.units === "mm" && scaleBarMm >= 1000
      ? `${scaleBarMm / 1000} м`
      : `${scaleBarMm} ${geometry?.units || "мм"}`;

  function patchPrefs(patch: Partial<typeof prefs>) {
    const next = { ...loadViewerPrefs(), ...patch };
    saveViewerPrefs(next);
    setPrefs(next);
  }

  return (
    <div className="group relative flex h-full min-h-0 flex-col">
      <div
        ref={wrapRef}
        tabIndex={0}
        data-viewer-wrap=""
        className={`relative min-h-0 flex-1 overflow-hidden bg-[#f7f8fa] outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${cursor}`}
        style={{ colorScheme: "only light" }}
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
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-sm text-[#8b93a3]">
            <Spinner className="h-5 w-5 text-sky-700" />
            <span>Загрузка геометрии листа…</span>
            <span className="pto-t-md text-muted">
              первый раз может занять несколько секунд
            </span>
          </div>
        ) : null}
        {!loading && error && !previewUrl ? (
          <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="max-w-sm rounded-xl border border-dashed border-slate-300 bg-white px-6 py-8 shadow-sm">
              <div className="text-sm font-semibold text-text">Лист без геометрии</div>
              <div className="mt-2 text-xs leading-relaxed text-muted">{error}</div>
              <div className="mt-3 pto-t-md text-muted">
                Текст листа справа, если конвейер его вернул.
              </div>
            </div>
          </div>
        ) : null}

        {!loading && (geometry || previewUrl) ? (
          <div
            className="absolute left-0 top-0 origin-top-left overflow-hidden"
            style={{
              width: natural.w,
              height: natural.h,
              transform: `translate(${viewport.pan.x}px, ${viewport.pan.y}px) scale(${viewport.scale})`,
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
                {showStrokes ? (
                  <g transform="scale(1,-1)">
                    {[...strokeGroups].map(([key, parts]) => {
                      const [color, lw] = key.split("|");
                      return (
                        <path
                          key={key}
                          d={parts.join("")}
                          fill="none"
                          stroke={color}
                          strokeWidth={
                            prefs.thinStrokes
                              ? 0.5 / Math.max(0.05, viewport.scale)
                              : Number(lw) || 0.25
                          }
                          vectorEffect={
                            prefs.thinStrokes ? "non-scaling-stroke" : undefined
                          }
                        />
                      );
                    })}
                  </g>
                ) : null}
                {showTexts
                  ? texts.map((t, index) => {
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
                          fontSize={prefs.largeLabels ? Math.max(size, minLabel) : size}
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
                    })
                  : null}
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
        ) : null}
      </div>

      {markMode ? (
        <div className="pointer-events-none absolute left-2 top-11 z-20 flex max-w-[calc(100%-0.75rem)] flex-wrap items-center gap-1">
          <span className="rounded bg-red-600 px-2 py-0.5 pto-t-sm font-medium leading-none text-white shadow-md">
            Обведите место на чертеже · Esc — отмена
          </span>
        </div>
      ) : null}

      <ViewerStatusBar
        scaleBar={
          geometry && ready ? (
            <span
              className="inline-flex items-end gap-2"
              data-viewer-scalebar=""
            >
              <span
                className="block border-b-2 border-text"
                style={{ width: Math.max(24, Math.min(120, scaleBarPx)) }}
              />
              <span className="tabular-nums">
                {scaleBarLabel}
                {geometry.scale ? ` · ${geometry.scale}` : ""}
              </span>
            </span>
          ) : null
        }
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

export type { CadBBox };
