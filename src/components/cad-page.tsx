"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/ui-chrome";
import { ViewerHint } from "@/components/viewer-hint";
import { ViewerMinimap } from "@/components/viewer-minimap";
import { ViewerToolbar } from "@/components/viewer-toolbar";
import { usePageViewport } from "@/hooks/use-page-viewport";
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
  const [wrapSize, setWrapSize] = useState({ w: 0, h: 0 });

  const ready = !loading && Boolean(geometry || previewUrl);
  const viewport = usePageViewport({
    wrapRef,
    natural,
    pageNumber,
    ready,
    highlightNonce,
    highlightRegion,
    panToHighlight,
    wheelMode: prefs.cadWheel,
    onUserZoom: () => {
      const next = loadViewerPrefs();
      if (!next.hintDismissed) {
        saveViewerPrefs({ ...next, hintDismissed: true });
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
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-sm text-[#8b93a3]">
            <Spinner className="h-5 w-5 text-sky-700" />
            <span>Загрузка геометрии листа…</span>
            <span className="text-[11px] text-muted">
              первый раз может занять несколько секунд
            </span>
          </div>
        ) : null}
        {!loading && error && !previewUrl ? (
          <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="max-w-sm rounded-xl border border-dashed border-slate-300 bg-white px-6 py-8 shadow-sm">
              <div className="text-sm font-semibold text-text">Лист без геометрии</div>
              <div className="mt-2 text-xs leading-relaxed text-muted">{error}</div>
              <div className="mt-3 text-[11px] text-muted">
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
        <ViewerHint show={hintOn} wheelMode={prefs.cadWheel} />
      )}

      {geometry && ready ? (
        <div
          className="pointer-events-none absolute bottom-2 left-2 z-20 flex items-end gap-2 rounded border border-border bg-white/90 px-2 py-1 text-[10px] text-muted shadow-sm"
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
        </div>
      ) : null}

      <ViewerMinimap
        natural={natural}
        scale={viewport.scale}
        pan={viewport.pan}
        viewW={wrapSize.w}
        viewH={wrapSize.h}
        visible={prefs.minimap && ready && viewport.scale > viewport.fitScale * 1.2}
        onJump={viewport.jumpToPagePoint}
      >
        {geometry && strokeGroups ? (
          <svg viewBox={viewBox} className="h-full w-full bg-white">
            <g transform="scale(1,-1)">
              {[...strokeGroups].map(([key, parts]) => {
                const [color] = key.split("|");
                return (
                  <path
                    key={key}
                    d={parts.join("")}
                    fill="none"
                    stroke={color}
                    strokeWidth={0.4}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>
          </svg>
        ) : previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-full w-full object-contain" />
        ) : null}
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
      />
    </div>
  );
}

export type { CadBBox };
