export type ReviewProgress = {
  viewed: number[];
  lastPage: number;
};

const cacheKey = (documentId: string) => `pto:progress:${documentId}`;

const emptyProgress = (): ReviewProgress => ({ viewed: [], lastPage: 1 });

/** Локальный кэш нужен только чтобы интерфейс не мигал до ответа сервера. */
export function loadCachedProgress(documentId: string): ReviewProgress {
  if (typeof window === "undefined") return emptyProgress();
  try {
    const raw = window.localStorage.getItem(cacheKey(documentId));
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Partial<ReviewProgress>;
    return normalize(parsed);
  } catch {
    return emptyProgress();
  }
}

export function cacheProgress(documentId: string, progress: ReviewProgress) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey(documentId), JSON.stringify(progress));
  } catch {
    // приватный режим браузера — не критично
  }
}

export async function fetchProgress(
  documentId: string,
  signal?: AbortSignal,
): Promise<ReviewProgress | null> {
  try {
    const response = await fetch(`/api/documents/${documentId}/progress`, { signal });
    if (!response.ok) return null;
    const payload = (await response.json()) as { progress?: Partial<ReviewProgress> };
    if (!payload.progress) return null;
    const progress = normalize(payload.progress);
    cacheProgress(documentId, progress);
    return progress;
  } catch {
    return null;
  }
}

export async function pushProgress(
  documentId: string,
  patch: Partial<ReviewProgress>,
): Promise<void> {
  try {
    await fetch(`/api/documents/${documentId}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    // офлайн: значения остаются в локальном кэше
  }
}

function normalize(raw: Partial<ReviewProgress>): ReviewProgress {
  const viewed = Array.isArray(raw.viewed)
    ? raw.viewed.filter((page) => Number.isInteger(page) && page > 0)
    : [];
  const lastPage =
    Number.isInteger(raw.lastPage) && (raw.lastPage ?? 0) > 0 ? raw.lastPage! : 1;
  return { viewed: [...new Set(viewed)].sort((a, b) => a - b), lastPage };
}
