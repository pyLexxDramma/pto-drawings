/** Рамка для зума к замечанию: крошечный rect с бэка иначе не видно. */
export function padHighlightRect(
  rect: { x: number; y: number; w: number; h: number },
  minW = 0.06,
  minH = 0.05,
): { x: number; y: number; w: number; h: number } {
  const w = Math.max(rect.w, minW);
  const h = Math.max(rect.h, minH);
  return {
    x: Math.max(0, Math.min(1 - w, rect.x + rect.w / 2 - w / 2)),
    y: Math.max(0, Math.min(1 - h, rect.y + rect.h / 2 - h / 2)),
    w,
    h,
  };
}

/** Не даёт утащить лист за край вьюпорта (пустой фон «ниже листа»). */
export function clampPan(
  pan: { x: number; y: number },
  opts: {
    viewW: number;
    viewH: number;
    contentW: number;
    contentH: number;
  },
): { x: number; y: number } {
  const { viewW, viewH, contentW, contentH } = opts;

  let x = pan.x;
  let y = pan.y;

  // Лист целиком в кадре — pan по оси выключен (центр).
  if (contentW <= viewW) {
    x = (viewW - contentW) / 2;
  } else {
    x = Math.min(0, Math.max(viewW - contentW, x));
  }

  if (contentH <= viewH) {
    y = (viewH - contentH) / 2;
  } else {
    y = Math.min(0, Math.max(viewH - contentH, y));
  }

  return { x, y };
}
