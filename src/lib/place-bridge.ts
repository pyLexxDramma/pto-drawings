/**
 * Мост между вкладкой разобранных замечаний и рабочей вкладкой: место
 * открывается там, откуда инженер ушёл, а не плодит третью вкладку.
 */
export const PLACE_MESSAGE = "pto-show-place";

export type PlacePayload = {
  projectId: string;
  documentId: string;
  page: number;
  reviewId?: string;
  quote?: string;
};

export type PlaceMessage = PlacePayload & { type: typeof PLACE_MESSAGE };

export function isPlaceMessage(data: unknown): data is PlaceMessage {
  if (!data || typeof data !== "object") return false;
  const value = data as Record<string, unknown>;
  return (
    value.type === PLACE_MESSAGE &&
    typeof value.projectId === "string" &&
    typeof value.documentId === "string" &&
    typeof value.page === "number"
  );
}

/** Ссылка на место для случая, когда рабочей вкладки уже нет. */
export function placeDeepLink(payload: PlacePayload): string {
  const params = new URLSearchParams({
    project: payload.projectId,
    doc: payload.documentId,
    page: String(payload.page),
    from: "reviews",
  });
  if (payload.reviewId) params.set("review", payload.reviewId);
  const quote = (payload.quote ?? "").trim();
  if (quote && quote.length <= 180) params.set("quote", quote);
  return `/?${params.toString()}`;
}

/**
 * Возвращает инженера в рабочую вкладку и показывает место. `false` — вкладка
 * закрыта, вызывающий сам решает, что делать (открыть место у себя).
 */
export function showPlaceInOpener(payload: PlacePayload): boolean {
  const opener = window.opener as Window | null;
  if (!opener || opener.closed) return false;
  try {
    const message: PlaceMessage = { type: PLACE_MESSAGE, ...payload };
    opener.postMessage(message, window.location.origin);
    opener.focus();
    return true;
  } catch {
    return false;
  }
}
