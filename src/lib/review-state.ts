const viewedKey = (id: string) => `pto:viewed:${id}`;
const lastKey = (id: string) => `pto:lastPage:${id}`;

export function loadViewedPages(documentId: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(viewedKey(documentId));
    const parsed = raw ? (JSON.parse(raw) as number[]) : [];
    return parsed.filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

export function saveViewedPages(documentId: string, pages: number[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(viewedKey(documentId), JSON.stringify([...new Set(pages)]));
}

export function loadLastPage(documentId: string): number {
  if (typeof window === "undefined") return 1;
  const value = Number(window.localStorage.getItem(lastKey(documentId)) ?? "1");
  return Number.isFinite(value) && value >= 1 ? value : 1;
}

export function saveLastPage(documentId: string, page: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(lastKey(documentId), String(page));
}
