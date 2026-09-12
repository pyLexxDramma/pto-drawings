import { buildXlsx, type Cell, type CellFill } from "@/lib/xlsx";
import { sortReviews } from "@/lib/reviews";
import {
  REVIEW_VERDICT_HIDDEN,
  type Review,
  type ReviewLocation,
  type ReviewSeverity,
} from "@/types";

/** Формат официальной отправки проектировщикам: № · Раздел · Замечание · Где в ПД. */
const HEADERS = ["№", "Раздел", "Замечание", "Где в ПД"];
const WIDTHS = [6, 12, 70, 46];

const SEVERITY_FILL: Record<ReviewSeverity, CellFill> = {
  high: "red",
  medium: "yellow",
  low: "green",
  skip: "none",
};

function place(location: ReviewLocation): string {
  const head = [location.documentName, location.pageNumber ? `стр. ${location.pageNumber}` : null]
    .filter(Boolean)
    .join(" · ");
  return location.quote ? `${head}\n«${location.quote}»` : head;
}

function whereInPd(review: Review): string {
  const places = review.locations.map(place).filter(Boolean).join("\n↔ ");
  if (review.needsRecheck) {
    return places ? `${places}\nнужно перепроверить` : "нужно перепроверить";
  }
  return places;
}

/** Формулировка инженера первична; для находок ИИ берём её обоснование. */
function wording(review: Review): string {
  return review.text || review.aiFinding;
}

/**
 * В выгрузку не идут «Не нужно» (важность), «Неактуально» (снято на разборе)
 * и «Неверно» (брак находки ИИ — отправлять проектировщикам нечего).
 */
export function exportableReviews(reviews: Review[]): Review[] {
  return sortReviews(reviews).filter(
    (item) =>
      item.severity !== "skip" && !REVIEW_VERDICT_HIDDEN.includes(item.verdict),
  );
}

export function buildReviewsXlsx(input: {
  projectName: string;
  reviews: Review[];
}): Buffer {
  const rows: Cell[][] = [
    HEADERS.map((title) => ({ value: title, bold: true, wrap: true })),
  ];

  exportableReviews(input.reviews).forEach((review, index) => {
    const fill = SEVERITY_FILL[review.severity];
    rows.push([
      { value: index + 1, fill },
      { value: review.section, fill, wrap: true },
      { value: wording(review), fill, wrap: true },
      { value: whereInPd(review), fill, wrap: true },
    ]);
  });

  return buildXlsx({
    name: "Замечания",
    columns: WIDTHS,
    rows,
    freezeHeader: true,
  });
}

export function reviewsFileName(projectName: string): string {
  const base = projectName.replace(/[\\/:*?"<>|]/g, "").trim() || "проект";
  const date = new Date().toISOString().slice(0, 10);
  return `${base} — замечания ${date}.xlsx`;
}
