"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { clampPan } from "@/lib/page-viewport";
import { getPageView, setPageView, type PageViewCache } from "@/lib/review-view-cache";

export type FitMode = "page" | "width";
export type WheelMode = "pan" | "zoom";
export type PageRegion = { x: number; y: number; w: number; h: number };

type Snap = PageViewCache;

function computeFitScale(
  wrap: { clientWidth: number; clientHeight: number },
  natural: { w: number; h: number },
  mode: FitMode,
  minScale: number,
) {
  const pad = 16;
  const scaleW = (wrap.clientWidth - pad) / Math.max(1, natural.w);
  const scaleH = (wrap.clientHeight - pad) / Math.max(1, natural.h);
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
  onUserZoom,
}: {
  wrapRef: RefObject<HTMLDivElement | null>;
  natural: { w: number; h: number };
  pageNumber: number;
  ready: boolean;
  viewCacheKey?: string;
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
  const fitModeRef = useRef<FitMode>("page");
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
    (mode: FitMode) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const n = naturalRef.current;
      const s = computeFitScale(wrap, n, mode, minScale);
      const contentW = n.w * s;
      const contentH = n.h * s;
      const nextPan = clampPan(
        {
          x: (wrap.clientWidth - contentW) / 2,
          y: contentH <= wrap.clientHeight ? (wrap.clientHeight - contentH) / 2 : 0,
        },
        {
          viewW: wrap.clientWidth,
          viewH: wrap.clientHeight,
          contentW,
          contentH,
        },
      );
      setFitScale(computeFitScale(wrap, n, "page", minScale));
      applyView(s, nextPan, mode);
    },
    [applyView, minScale, wrapRef],
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
    (rect: PageRegion) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const n = naturalRef.current;
      const pad = 24;
      const tw = Math.max(0.008, rect.w) * n.w;
      const th = Math.max(0.008, rect.h) * n.h;
      const pageFit = computeFitScale(wrap, n, "page", minScale);
      const raw = Math.min((wrap.clientWidth - pad) / tw, (wrap.clientHeight - pad) / th);
      const nextScale = Math.min(pageFit * maxZoomFactor, Math.max(minScale, raw));
      const cx = (rect.x + rect.w / 2) * n.w * nextScale;
      const cy = (rect.y + rect.h / 2) * n.h * nextScale;
      applyView(
        nextScale,
        boundPan(
          { x: wrap.clientWidth / 2 - cx, y: wrap.clientHeight / 2 - cy },
          nextScale,
        ),
      );
      onUserZoom?.();
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
    if (cached) {
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
    fit("width");
  }, [applyView, fit, minScale, natural.h, natural.w, pageNumber, ready, viewCacheKey, wrapRef]);

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
      fit(fitModeRef.current);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, pageNumber, ready, wrapRef]);

  useEffect(() => {
    if (!highlightNonce) return;
    fit("page");
  }, [fit, highlightNonce]);

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
  }, [boundPan, highlightRegion, panToHighlight, scale, natural.w, natural.h, wrapRef]);

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
