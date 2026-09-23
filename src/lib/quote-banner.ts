/** Счётчик поиска на чертеже: null — зритель ещё не ответил. */
export type DrawingHitCount = number | null;

export type QuoteBannerKind =
  | "model-no-layer"
  | "miss-both"
  | "miss-drawing"
  | "miss-text";

/**
 * Плашка «цитата не найдена» только когда и чертёж, и текст явно ответили
 * «нет». Пока зритель молчит (count === null) или цитата нашлась хотя бы
 * кусками / рамкой — плашки нет: иначе она горела поверх живой подсветки.
 */
export function quoteBannerKind(input: {
  bannerOn: boolean;
  focusDrawing: boolean;
  pageSource?: string | null;
  textHitFound: boolean | null;
  drawingHitCount: DrawingHitCount;
  /** Рамка или подсветка на листе уже есть — промах не показываем. */
  highlighted?: boolean;
}): QuoteBannerKind | null {
  if (!input.bannerOn || !input.focusDrawing) return null;
  if (input.highlighted) return null;
  if (input.drawingHitCount !== null && input.drawingHitCount > 0) return null;
  if (input.textHitFound === true) return null;
  if (input.drawingHitCount === null || input.textHitFound === null) return null;
  if (input.pageSource === "model") return "model-no-layer";
  return "miss-both";
}
