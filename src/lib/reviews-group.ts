import { REVIEW_SEVERITY_ORDER, type Review } from "@/types";

export type GroupBy = "section" | "file";

export const CROSS_FILE_GROUP = "Межраздел · несколько файлов";

/**
 * Файл замечания. Замечание про расхождение ссылается на два места, и если это
 * разные файлы — оно не принадлежит ни одному, поэтому отдельная группа.
 */
export function fileGroupOf(review: Review): string {
  const names = [
    ...new Set(
      review.locations
        .map((location) => location.documentName.trim())
        .filter(Boolean),
    ),
  ];
  if (names.length === 1) return names[0];
  return CROSS_FILE_GROUP;
}

export function groupKeyOf(review: Review, groupBy: GroupBy): string {
  return groupBy === "section" ? review.section : fileGroupOf(review);
}

export type ReviewGroup = { key: string; items: Review[] };

/**
 * Группы в порядке первого появления: список с сервера уже отсортирован по
 * комплекту ПД, так что порядок групп сам совпадает с порядком разделов.
 * Сборная группа всегда уходит в конец.
 */
export function groupReviews(
  reviews: Review[],
  groupBy: GroupBy,
): ReviewGroup[] {
  const groups = new Map<string, Review[]>();
  for (const review of reviews) {
    const key = groupKeyOf(review, groupBy);
    const bucket = groups.get(key);
    if (bucket) bucket.push(review);
    else groups.set(key, [review]);
  }

  const ordered = [...groups.entries()].map(([key, items]) => ({
    key,
    // Внутри группы важное сверху; сортировка стабильна, поэтому при равной
    // важности сохраняется порядок комплекта ПД, пришедший с сервера.
    items: [...items].sort(
      (a, b) =>
        REVIEW_SEVERITY_ORDER.indexOf(a.severity) -
        REVIEW_SEVERITY_ORDER.indexOf(b.severity),
    ),
  }));

  return ordered.sort((a, b) => {
    if (a.key === CROSS_FILE_GROUP) return 1;
    if (b.key === CROSS_FILE_GROUP) return -1;
    return 0;
  });
}
