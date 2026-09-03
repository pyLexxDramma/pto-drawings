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
