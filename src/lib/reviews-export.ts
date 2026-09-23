import { buildXlsx, type Cell, type CellFill } from "@/lib/xlsx";
import { sortReviews } from "@/lib/reviews";
import { locationLabel, remarkWording } from "@/lib/sheet-label";
import {
  isExportableReview,
  reviewAuthor,
  type Review,
  type ReviewLocation,
  type ReviewSeverity,
} from "@/types";

/** Как в таблице на экране: № · Раздел · Замечание · Где в ПД · Автор. */
const HEADERS = ["№", "Раздел", "Замечание", "Где в ПД", "Автор"];
const WIDTHS = [6, 12, 70, 46, 16];

const SEVERITY_FILL: Record<ReviewSeverity, CellFill> = {
  unset: "none",
  high: "red",
  medium: "yellow",
  low: "green",
  skip: "none",
};

function place(location: ReviewLocation): string {
  // Формат адреса один на таблицу, подсветку и выгрузку — см. lib/sheet-label.
  const head = locationLabel(location);
  return location.quote ? `${head}\n«${location.quote}»` : head;
}

function whereInPd(review: Review): string {
  const places = review.locations.map(place).filter(Boolean).join("\n↔ ");
  if (review.needsRecheck) {
    return places ? `${places}\nнужно перепроверить` : "нужно перепроверить";
  }
  return places;
}

/**
 * Формулировка инженера первична; для находок ИИ берём её обоснование. Адрес
 * листа из начала формулировки срезаем: он дублирует колонку «Где в ПД», а
 * «лист 6, стр. 1» рядом с «лист 28» проектировщики читают как ошибку (0097).
 */
function wording(review: Review): string {
  return remarkWording(review.text || review.aiFinding);
}

/**
 * В выгрузку не идут «Не задана», «Не нужно», «Неактуально» и «Неверно».
 */
export function exportableReviews(reviews: Review[]): Review[] {
  return sortReviews(reviews).filter(isExportableReview);
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
      { value: reviewAuthor(review), fill, wrap: true },
    ]);
  });

  return buildXlsx({
    name: "Замечания",
    columns: WIDTHS,
    rows,
    freezeHeader: true,
    autoFilter: true,
  });
}

export function reviewsFileName(projectName: string): string {
  const base = projectName.replace(/[\\/:*?"<>|]/g, "").trim() || "проект";
  const date = new Date().toISOString().slice(0, 10);
  return `${base} — замечания ${date}.xlsx`;
}
