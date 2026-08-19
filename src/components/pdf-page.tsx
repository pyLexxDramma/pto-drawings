"use client";

import { useEffect, useRef, useState } from "react";

type PdfPageProps = {
  url: string;
  pageNumber: number;
};

export function PdfPage({ url, pageNumber }: PdfPageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [natural, setNatural] = useState({ w: 800, h: 1100 });
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [grabbing, setGrabbing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;

    (async () => {
      setLoading(true);
      setError(null);
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
  }, [url, pageNumber]);

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
    setScale(Math.max(0.15, next));
    setPan({ x: pad / 2, y: pad / 2 });
  }

  useEffect(() => {
    if (!loading && !error) fit("page");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, natural.w, natural.h, pageNumber]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      setScale((value) => Math.min(8, Math.max(0.15, value * factor)));
    };
    wrap.addEventListener("wheel", onWheelNative, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheelNative);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-white px-2 py-1">
        <button
          type="button"
          onClick={() => fit("page")}
          className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-bg"
        >
          Страница
        </button>
        <button
          type="button"
          onClick={() => fit("width")}
          className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-bg"
        >
          По ширине
        </button>
        <span className="ml-auto text-[11px] text-muted">
          {Math.round(scale * 100)} % Zoom
        </span>
      </div>
      <div
        ref={wrapRef}
        className={`relative min-h-0 flex-1 overflow-hidden bg-[#eceff3] ${
          grabbing ? "cursor-grabbing" : "cursor-grab"
        }`}
        onWheel={(event) => event.preventDefault()}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          setGrabbing(true);
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            panX: pan.x,
            panY: pan.y,
          };
        }}
        onMouseMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          setPan({
            x: drag.panX + (event.clientX - drag.x),
            y: drag.panY + (event.clientY - drag.y),
          });
        }}
        onMouseUp={() => {
          dragRef.current = null;
          setGrabbing(false);
        }}
        onMouseLeave={() => {
          dragRef.current = null;
          setGrabbing(false);
        }}
      >
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted">
            Страница загружается…
          </div>
        ) : null}
        {error ? (
          <iframe
            title="PDF"
            src={`${url}#page=${pageNumber}`}
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <canvas
            ref={canvasRef}
            className="origin-top-left bg-white shadow-[0_8px_30px_rgba(15,23,42,0.12)]"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            }}
          />
        )}
      </div>
    </div>
  );
}
