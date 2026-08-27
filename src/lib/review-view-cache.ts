/** Кэш вида проверки по documentId — переживает смену файла/проекта. */

export type PageViewCache = {
  scale: number;
  pan: { x: number; y: number };
  fitMode: "page" | "width";
};

export type DocumentViewCache = {
  pageNumber?: number;
  paneSolo?: "pdf" | "md" | null;
  galleryMode?: boolean;
  pages?: Record<number, PageViewCache>;
};

const byDoc = new Map<string, DocumentViewCache>();

export function getDocumentView(docId: string): DocumentViewCache | undefined {
  return byDoc.get(docId);
}

export function patchDocumentView(
  docId: string,
  patch: Partial<DocumentViewCache>,
): DocumentViewCache {
  const prev = byDoc.get(docId) ?? {};
  const next = { ...prev, ...patch };
  if (patch.pages) {
    next.pages = { ...(prev.pages ?? {}), ...patch.pages };
  }
  byDoc.set(docId, next);
  return next;
}

export function getPageView(
  docId: string,
  pageNumber: number,
): PageViewCache | undefined {
  return byDoc.get(docId)?.pages?.[pageNumber];
}

export function setPageView(
  docId: string,
  pageNumber: number,
  view: PageViewCache,
): void {
  const prev = byDoc.get(docId) ?? {};
  byDoc.set(docId, {
    ...prev,
    pages: { ...(prev.pages ?? {}), [pageNumber]: view },
  });
}
