import type { PageAnnotation, Review } from "@/types";

export type AnnotationHint = {
  reviewId?: string | null;
  pageNumber: number;
  comment: string;
};

/**
 * Пометка на чертеже и строка таблицы — одна сущность. Связь по reviewId,
 * для старых пометок без id — по листу и тексту.
 */
export function matchEngineerReview(
  reviews: Review[],
  documentId: string,
  hint: AnnotationHint,
): Review | null {
  if (hint.reviewId) {
    const byId = reviews.find((item) => item.id === hint.reviewId);
    if (byId) return byId;
  }
  const comment = hint.comment.trim().toLowerCase();
  if (!comment) return null;
  return (
    reviews.find((item) => {
      if (item.origin === "ai") return false;
      return item.locations.some((loc) => {
        if (loc.documentId && loc.documentId !== documentId) return false;
        if (loc.pageNumber != null && loc.pageNumber !== hint.pageNumber) {
          return false;
        }
        const quote = loc.quote.trim().toLowerCase();
        const text = item.text.trim().toLowerCase();
        return (
          quote === comment ||
          text === comment ||
          text.startsWith(`${comment}.`)
        );
      });
    }) ?? null
  );
}

export function annotationBelongsToReview(
  documentId: string,
  annotation: PageAnnotation,
  review: Review,
): boolean {
  if (annotation.reviewId && annotation.reviewId === review.id) return true;
  return matchEngineerReview([review], documentId, annotation) === review;
}
