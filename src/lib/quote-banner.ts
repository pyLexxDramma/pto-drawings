/** Счётчик поиска на чертеже: null — зритель ещё не ответил. */
export type DrawingHitCount = number | null;

export type QuoteBannerKind = "model-no-layer";

/**
 * Плашка только у листа без текстового слоя, когда и чертёж, и расшифровка
 * явно не нашли цитату. Если слой есть, а точного совпадения нет, плашки нет:
 * слова на листе часто видны, поиск их просто не узнал.
 */
export function quoteBannerKind(input: {
  bannerOn: boolean;
  focusDrawing: boolean;
  pageSource?: string | null;
  textHitFound: boolean | null;
  drawingHitCount: DrawingHitCount;
  /** Рамка или подсветка на листе уже есть — промах не показываем. */
  highlighted?: boolean;
  /** Пин замечания уже стоит на листе — плашка не нужна. */
  hasPin?: boolean;
}): QuoteBannerKind | null {
  if (!input.bannerOn || !input.focusDrawing) return null;
  if (input.pageSource !== "model") return null;
  if (input.highlighted || input.hasPin) return null;
  if (input.drawingHitCount !== null && input.drawingHitCount > 0) return null;
  if (input.textHitFound === true) return null;
  if (input.drawingHitCount === null || input.textHitFound === null) return null;
  return "model-no-layer";
}
