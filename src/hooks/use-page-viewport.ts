"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  clampPan,
  highlightZoomScale,
  legibleFitScale,
  padHighlightRect,
} from "@/lib/page-viewport";
import {
  getDocumentView,
  getPageView,
  patchDocumentView,
  setPageView,
  type PageViewCache,
} from "@/lib/review-view-cache";

export { LEGIBLE_MIN_PX } from "@/lib/page-viewport";

export type FitMode = "page" | "width" | "legible";
export type WheelMode = "pan" | "zoom";
export type PageRegion = { x: number; y: number; w: number; h: number };

type Snap = PageViewCache;

function computeFitScale(
  wrap: { clientWidth: number; clientHeight: number },
  natural: { w: number; h: number },
  mode: FitMode,
  minScale: number,
  legibleTextPx = 0,
  widestLinePx = 0,
) {
  const pad = 16;
  const scaleW = (wrap.clientWidth - pad) / Math.max(1, natural.w);
  const scaleH = (wrap.clientHeight - pad) / Math.max(1, natural.h);
  if (mode === "legible") {
    const lineScale = widestLinePx > 0 ? (wrap.clientWidth - pad) / widestLinePx : Number.POSITIVE_INFINITY;
    return legibleFitScale(scaleW, legibleTextPx, minScale, lineScale);
  }
  const next = mode === "width" ? scaleW : Math.min(scaleW, scaleH);
  return Math.max(minScale, next);
}

export function usePageViewport({
  wrapRef,
  natural,
  pageNumber,
  ready,
  viewCacheKey,
  minScale = 0.05,
  maxZoomFactor = 40,
  highlightNonce = 0,
  highlightRegion = null,
  panToHighlight = false,
  wheelMode = "pan",
  legibleTextPx = 0,
  widestLinePx = 0,
  onUserZoom,
}: {
  wrapRef: RefObject<HTMLDivElement | null>;
  natural: { w: number; h: number };
  pageNumber: number;
  ready: boolean;
  viewCacheKey?: string;
  /** Медианная высота подписи листа в его собственных единицах — для «Читаемо». */
  legibleTextPx?: number;
  /** Ширина самой длинной строки в тех же единицах. «Читаемо» не шире неё. */
  widestLinePx?: number;
  minScale?: number;
  maxZoomFactor?: number;
  highlightNonce?: number;
  highlightRegion?: PageRegion | null;
  panToHighlight?: boolean;
  wheelMode?: WheelMode;
  onUserZoom?: () => void;
}) {
  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const naturalRef = useRef(natural);
  const legibleRef = useRef(legibleTextPx);
  const widestRef = useRef(widestLinePx);
  const fitModeRef = useRef<FitMode>("page");
  /** Лист открыт из сохранённого вида — авто-«Читаемо» его не перебивает. */
  const restoredRef = useRef(false);
  const preferredFitRef = useRef<FitMode | null>(
    viewCacheKey ? (getDocumentView(viewCacheKey)?.preferredFit ?? null) : null,
  );
  const pageRef = useRef(pageNumber);
  const viewCacheRef = useRef(new Map<number, Snap>());
  const dragRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const clickRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const applyingSync = useRef(false);

  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fitMode, setFitMode] = useState<FitMode>("page");
  const [grabbing, setGrabbing] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [fitScale, setFitScale] = useState(1);
  /** Масштаб, при котором подписи листа читаются, — 0, если размер неизвестен. */
  const [legibleScale, setLegibleScale] = useState(0);

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
    legibleRef.current = legibleTextPx;
  }, [legibleTextPx]);
  useEffect(() => {
    widestRef.current = widestLinePx;
  }, [widestLinePx]);
  useEffect(() => {
    fitModeRef.current = fitMode;
  }, [fitMode]);

  const persist = useCallback(
    (page: number, snap: Snap) => {
      viewCacheRef.current.set(page, snap);
      if (viewCacheKey) setPageView(viewCacheKey, page, snap);
    },
    [viewCacheKey],
  );

  useEffect(() => {
    const prev = pageRef.current;
    if (prev !== pageNumber) {
      persist(prev, {
        scale: scaleRef.current,
        pan: { ...panRef.current },
        fitMode: fitModeRef.current,
      });
      pageRef.current = pageNumber;
    }
  }, [pageNumber, persist]);

  useEffect(() => {
    return () => {
      persist(pageRef.current, {
        scale: scaleRef.current,
        pan: { ...panRef.current },
        fitMode: fitModeRef.current,
      });
    };
  }, [persist]);

  const boundPan = useCallback((next: { x: number; y: number }, s = scaleRef.current) => {
    const wrap = wrapRef.current;
    const n = naturalRef.current;
    if (!wrap) return next;
    return clampPan(next, {
      viewW: wrap.clientWidth,
      viewH: wrap.clientHeight,
      contentW: n.w * s,
      contentH: n.h * s,
    });
  }, [wrapRef]);

  const applyView = useCallback(
    (nextScale: number, nextPan: { x: number; y: number }, mode?: FitMode) => {
      scaleRef.current = nextScale;
      panRef.current = nextPan;
      setScale(nextScale);
      setPan(nextPan);
      if (mode) {
        fitModeRef.current = mode;
        setFitMode(mode);
      }
    },
    [],
  );

  const zoomBy = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const oldScale = scaleRef.current;
      const pageFit = computeFitScale(wrap, naturalRef.current, "page", minScale);
      const maxScale = pageFit * maxZoomFactor;
      const nextScale = Math.min(maxScale, Math.max(minScale, oldScale * factor));
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
      applyView(nextScale, nextPan);
      onUserZoom?.();
    },
    [applyView, boundPan, maxZoomFactor, minScale, onUserZoom, wrapRef],
  );

  const fit = useCallback(
    (mode: FitMode, opts?: { remember?: boolean }) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const n = naturalRef.current;
      const s = computeFitScale(
        wrap,
        n,
        mode,
        minScale,
        legibleRef.current,
        widestRef.current,
      );
      const contentW = n.w * s;
      const contentH = n.h * s;
      // «Читаемо» показывает начало листа: по центру лист обрезан с обеих сторон,
      // и инженер не понимает, где он оказался.
      const nextPan = clampPan(
        mode === "legible"
          ? { x: 0, y: 0 }
          : {
              x: (wrap.clientWidth - contentW) / 2,
              y:
                contentH <= wrap.clientHeight
                  ? (wrap.clientHeight - contentH) / 2
                  : 0,
            },
        {
          viewW: wrap.clientWidth,
          viewH: wrap.clientHeight,
          contentW,
          contentH,
        },
      );
      setFitScale(computeFitScale(wrap, n, "page", minScale));
      setLegibleScale(
        legibleRef.current > 0
          ? computeFitScale(
              wrap,
              n,
              "legible",
              minScale,
              legibleRef.current,
              widestRef.current,
            )
          : 0,
      );
      applyView(s, nextPan, mode);
      if (opts?.remember !== false) {
        preferredFitRef.current = mode;
        if (viewCacheKey) patchDocumentView(viewCacheKey, { preferredFit: mode });
      }
    },
    [applyView, minScale, viewCacheKey, wrapRef],
  );

  const setScalePercent = useCallback(
    (percent: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const pageFit = computeFitScale(wrap, naturalRef.current, "page", minScale);
      const maxScale = pageFit * maxZoomFactor;
      const nextScale = Math.min(maxScale, Math.max(minScale, percent / 100));
      const cx = wrap.clientWidth / 2;
      const cy = wrap.clientHeight / 2;
      const oldScale = scaleRef.current;
      const oldPan = panRef.current;
      const contentX = (cx - oldPan.x) / oldScale;
      const contentY = (cy - oldPan.y) / oldScale;
      applyView(
        nextScale,
        boundPan(
          { x: cx - contentX * nextScale, y: cy - contentY * nextScale },
          nextScale,
        ),
      );
      onUserZoom?.();
    },
    [applyView, boundPan, maxZoomFactor, minScale, onUserZoom, wrapRef],
  );

  const zoomToRect = useCallback(
    (rect: PageRegion, opts?: { highlight?: boolean; gentle?: boolean }) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const n = naturalRef.current;
      const pad = 24;
      const tw = Math.max(0.008, rect.w) * n.w;
      const th = Math.max(0.008, rect.h) * n.h;
      const pageFit = computeFitScale(wrap, n, "page", minScale);
      const widthFit = computeFitScale(wrap, n, "width", minScale);
      const raw = Math.min((wrap.clientWidth - pad) / tw, (wrap.clientHeight - pad) / th);
      const fitted = opts?.highlight ? highlightZoomScale(raw) : raw;
      let nextScale = Math.min(pageFit * maxZoomFactor, Math.max(minScale, fitted));
      // Поиск по слову иначе уводит лист на 260% и рамку ошибки не поставить.
      if (opts?.gentle) {
        nextScale = Math.min(nextScale, Math.max(scaleRef.current, widthFit * 1.35));
      }
      const cx = (rect.x + rect.w / 2) * n.w * nextScale;
      const cy = (rect.y + rect.h / 2) * n.h * nextScale;
      applyView(
        nextScale,
        boundPan(
          { x: wrap.clientWidth / 2 - cx, y: wrap.clientHeight / 2 - cy },
          nextScale,
        ),
      );
      if (!opts?.highlight) onUserZoom?.();
    },
    [applyView, boundPan, maxZoomFactor, minScale, onUserZoom, wrapRef],
  );

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const next = boundPan({
        x: panRef.current.x + dx,
        y: panRef.current.y + dy,
      });
      panRef.current = next;
      setPan(next);
    },
    [boundPan],
  );

  const jumpToPagePoint = useCallback(
    (nx: number, ny: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const n = naturalRef.current;
      const s = scaleRef.current;
      applyView(
        s,
        boundPan({
          x: wrap.clientWidth / 2 - nx * n.w * s,
          y: wrap.clientHeight / 2 - ny * n.h * s,
        }),
      );
    },
    [applyView, boundPan, wrapRef],
  );

  useEffect(() => {
    if (!ready) return;
    const cached =
      viewCacheRef.current.get(pageNumber) ??
      (viewCacheKey ? getPageView(viewCacheKey, pageNumber) : undefined);
    if (panToHighlight && highlightNonce && highlightRegion) return;
    if (cached) {
      restoredRef.current = true;
      viewCacheRef.current.set(pageNumber, cached);
      const wrap = wrapRef.current;
      const clamped = wrap
        ? clampPan(cached.pan, {
            viewW: wrap.clientWidth,
            viewH: wrap.clientHeight,
            contentW: natural.w * cached.scale,
            contentH: natural.h * cached.scale,
          })
        : cached.pan;
      applyView(cached.scale, clamped, cached.fitMode);
      if (wrap) setFitScale(computeFitScale(wrap, natural, "page", minScale));
      return;
    }
    restoredRef.current = false;
    const preferred =
      (viewCacheKey ? getDocumentView(viewCacheKey)?.preferredFit : undefined) ??
      preferredFitRef.current;
    // Без своего вида — последний выбранный масштаб. Иначе каждый лист
    // открывался «по ширине»: на А1 это 20%, и подписи не читаются.
    fit(preferred ?? "width", { remember: false });
  }, [
    applyView,
    fit,
    highlightNonce,
    highlightRegion,
    minScale,
    natural.h,
    natural.w,
    pageNumber,
    panToHighlight,
    ready,
    viewCacheKey,
    wrapRef,
  ]);

  // Первый заход на лист: «по ширине» на крупном формате мельче порога
  // читаемости. Поднимаем «Читаемо» сами и запоминаем для следующих листов.
  useEffect(() => {
    if (!ready || restoredRef.current || legibleTextPx <= 0) return;
    const preferred =
      (viewCacheKey ? getDocumentView(viewCacheKey)?.preferredFit : undefined) ??
      preferredFitRef.current;
    if (preferred) return;
    const wrap = wrapRef.current;
    if (!wrap || wrap.clientWidth < 8) return;
    const widthScale = computeFitScale(wrap, natural, "width", minScale);
    const legible = computeFitScale(
      wrap,
      natural,
      "legible",
      minScale,
      legibleTextPx,
      widestLinePx,
    );
    if (legible <= widthScale * 1.15) return;
    fit("legible");
  }, [fit, legibleTextPx, widestLinePx, minScale, natural, pageNumber, ready, viewCacheKey, wrapRef]);

  // Размер подписей приходит после первой отрисовки листа (текстовый слой PDF,
  // геометрия DWG) — «читаемый» масштаб пересчитываем, когда он появился.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !ready || wrap.clientWidth < 8) return;
    const next =
      legibleTextPx > 0
        ? computeFitScale(wrap, natural, "legible", minScale, legibleTextPx, widestLinePx)
        : 0;
    setLegibleScale(next);
    // До замера подписи «Читаемо» совпадает с «по ширине». Когда высота
    // букв пришла — подтягиваем масштаб, иначе следующий лист снова 20%.
    if (next > 0 && fitModeRef.current === "legible" && !restoredRef.current) {
      fit("legible", { remember: false });
    }
  }, [fit, legibleTextPx, widestLinePx, minScale, natural, pageNumber, ready, wrapRef]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !ready) return;
    let prevW = wrap.clientWidth;
    let prevH = wrap.clientHeight;
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w < 8 || h < 8) return;
      if (Math.abs(w - prevW) < 2 && Math.abs(h - prevH) < 2) return;
      prevW = w;
      prevH = h;
      fit(fitModeRef.current, { remember: false });
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, pageNumber, ready, wrapRef]);

  const zoomToRectRef = useRef(zoomToRect);
  zoomToRectRef.current = zoomToRect;
  const appliedHighlight = useRef("");

  useEffect(() => {
    if (!panToHighlight || !highlightRegion || !highlightNonce) return;
    const key = [
      highlightNonce,
      highlightRegion.x.toFixed(4),
      highlightRegion.y.toFixed(4),
      highlightRegion.w.toFixed(4),
      highlightRegion.h.toFixed(4),
    ].join(":");
    if (appliedHighlight.current === key) return;
    const wrap = wrapRef.current;
    if (!wrap || wrap.clientWidth < 8 || wrap.clientHeight < 8) return;
    if (!ready) return;
    appliedHighlight.current = key;
    zoomToRectRef.current(padHighlightRect(highlightRegion), { highlight: true });
  }, [highlightNonce, highlightRegion, panToHighlight, ready, wrapRef]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      const zoomGesture = event.ctrlKey || event.metaKey;
      const zoomNow = wheelMode === "zoom" ? !zoomGesture : zoomGesture;
      if (!zoomNow) {
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
  }, [boundPan, wheelMode, wrapRef, zoomBy]);

  useEffect(() => {
    function typing(target: EventTarget | null) {
      const el = target as HTMLElement | null;
      if (!el) return false;
      return (
        ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
        el.isContentEditable
      );
    }
    function onDown(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat) return;
      if (typing(event.target)) return;
      event.preventDefault();
      setSpaceHeld(true);
    }
    function onUp(event: KeyboardEvent) {
      if (event.code === "Space") setSpaceHeld(false);
    }
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

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

  function startPan(clientX: number, clientY: number) {
    clickRef.current = { x: clientX, y: clientY, moved: false };
    setGrabbing(true);
    dragRef.current = {
      x: clientX,
      y: clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
  }

  function movePan(clientX: number, clientY: number) {
    const drag = dragRef.current;
    if (!drag) return false;
    if (
      clickRef.current &&
      (Math.abs(clientX - clickRef.current.x) > 4 ||
        Math.abs(clientY - clickRef.current.y) > 4)
    ) {
      clickRef.current.moved = true;
    }
    const next = boundPan({
      x: drag.panX + (clientX - drag.x),
      y: drag.panY + (clientY - drag.y),
    });
    panRef.current = next;
    setPan(next);
    return true;
  }

  function endPan() {
    const wasClick = Boolean(clickRef.current && !clickRef.current.moved);
    dragRef.current = null;
    clickRef.current = null;
    setGrabbing(false);
    return wasClick;
  }

  const canPan = useMemo(() => {
    const wrap = wrapRef.current;
    if (!wrap) return false;
    return (
      natural.w * scale > wrap.clientWidth + 1 ||
      natural.h * scale > wrap.clientHeight + 1
    );
  }, [natural.h, natural.w, scale, wrapRef]);

  return {
    scale,
    pan,
    fitMode,
    fitScale,
    legibleScale,
    /** Высота медианной подписи на экране при текущем масштабе, px. */
    textOnScreenPx: legibleTextPx > 0 ? legibleTextPx * scale : 0,
    grabbing,
    spaceHeld,
    canPan,
    zoomBy,
    fit,
    setScalePercent,
    zoomToRect,
    panBy,
    jumpToPagePoint,
    boundPan,
    toPagePoint,
    startPan,
    movePan,
    endPan,
  };
}
