"use client";

import { useRef, type ReactNode } from "react";

export function ViewerMinimap({
  natural,
  scale,
  pan,
  viewW,
  viewH,
  visible,
  onJump,
  children,
}: {
  natural: { w: number; h: number };
  scale: number;
  pan: { x: number; y: number };
  viewW: number;
  viewH: number;
  visible: boolean;
  onJump: (nx: number, ny: number) => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  if (!visible || viewW < 8 || viewH < 8) return null;

  const contentW = natural.w * scale;
  const contentH = natural.h * scale;
  const vx = contentW <= 0 ? 0 : -pan.x / contentW;
  const vy = contentH <= 0 ? 0 : -pan.y / contentH;
  const vw = contentW <= 0 ? 1 : viewW / contentW;
  const vh = contentH <= 0 ? 1 : viewH / contentH;

  function pointFromEvent(clientX: number, clientY: number) {
    const node = rootRef.current;
    if (!node) return { x: 0.5, y: 0.5 };
    const rect = node.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }

  return (
    <div
      ref={rootRef}
      data-viewer-minimap=""
      className="absolute bottom-2 right-2 z-20 h-28 w-20 overflow-hidden rounded border border-border bg-white shadow-sm"
      onMouseDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
        const point = pointFromEvent(event.clientX, event.clientY);
        onJump(point.x, point.y);
      }}
      onMouseMove={(event) => {
        if (event.buttons !== 1) return;
        const point = pointFromEvent(event.clientX, event.clientY);
        onJump(point.x, point.y);
      }}
      title="Обзор листа — клик переходит в точку"
    >
      <div className="absolute inset-0">{children}</div>
      <div
        className="pointer-events-none absolute border border-accent bg-accent/15"
        style={{
          left: `${vx * 100}%`,
          top: `${vy * 100}%`,
          width: `${Math.max(6, vw * 100)}%`,
          height: `${Math.max(6, vh * 100)}%`,
        }}
      />
    </div>
  );
}
