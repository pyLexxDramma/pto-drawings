/** Рамка для зума к замечанию: крошечный rect с бэка иначе не видно. */
export const HIGHLIGHT_PAD_W = 0.14;
export const HIGHLIGHT_PAD_H = 0.12;
/** Вокруг рамки оставляем поле — иначе 500% и не видно контекста. */
export const HIGHLIGHT_CONTEXT = 1.4;
/** Жёсткий потолок абсолютного масштаба при клике на замечание. */
export const HIGHLIGHT_MAX_SCALE = 2.6;

export function padHighlightRect(
  rect: { x: number; y: number; w: number; h: number },
  minW = HIGHLIGHT_PAD_W,
  minH = HIGHLIGHT_PAD_H,
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

export function highlightZoomScale(raw: number): number {
  return Math.min(HIGHLIGHT_MAX_SCALE, raw / HIGHLIGHT_CONTEXT);
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
