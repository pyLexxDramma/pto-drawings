/** Не даёт утащить лист за край вьюпорта (пустой фон «ниже листа»). */
export function clampPan(
  pan: { x: number; y: number },
  opts: {
    viewW: number;
    viewH: number;
    contentW: number;
    contentH: number;
    pad?: number;
  },
): { x: number; y: number } {
  const pad = opts.pad ?? 16;
  const { viewW, viewH, contentW, contentH } = opts;

  let x = pan.x;
  let y = pan.y;

  if (contentW <= viewW - pad) {
    x = Math.max(pad / 2, (viewW - contentW) / 2);
  } else {
    const maxX = pad / 2;
    const minX = viewW - contentW - pad / 2;
    x = Math.min(maxX, Math.max(minX, x));
  }

  if (contentH <= viewH - pad) {
    y = Math.max(pad / 2, (viewH - contentH) / 2);
  } else {
    const maxY = pad / 2;
    const minY = viewH - contentH - pad / 2;
    y = Math.min(maxY, Math.max(minY, y));
  }

  return { x, y };
}
