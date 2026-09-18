/** Счётчик поиска на чертеже: null — зритель ещё не ответил. */
export type DrawingHitCount = number | null;

export type QuoteBannerKind =
  | "model-no-layer"
  | "miss-both"
  | "miss-drawing"
  | "miss-text";

/**
 * Плашка «цитата не найдена» только после ответа зрителя.
 * Пока count === null — не считать промахом (иначе гаснет «найдено: N»).
 */
export function quoteBannerKind(input: {
  bannerOn: boolean;
  focusDrawing: boolean;
  pageSource?: string | null;
  textHitFound: boolean | null;
  drawingHitCount: DrawingHitCount;
}): QuoteBannerKind | null {
  if (!input.bannerOn || !input.focusDrawing) return null;
  const model = input.pageSource === "model";
  if (!model && input.textHitFound === null) return null;

  const drawingReady = input.drawingHitCount !== null;
  const drawingMiss = input.drawingHitCount === 0;
  const textMiss = input.textHitFound === false;

  if (!drawingMiss && !textMiss && !model) return null;
  if (!drawingReady && !textMiss && !model) return null;

  if (model && (!drawingReady || drawingMiss)) {
    return "model-no-layer";
  }
  if (!drawingReady) {
    return textMiss ? "miss-text" : null;
  }
  if (drawingMiss && textMiss) return "miss-both";
  if (drawingMiss) return "miss-drawing";
  if (textMiss) return "miss-text";
  return null;
}
