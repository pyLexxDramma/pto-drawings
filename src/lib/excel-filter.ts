import {
  REVIEW_SEVERITY_LABEL,
  REVIEW_VERDICT_LABEL,
  type Review,
} from "@/types";
import { sheetLabel } from "@/lib/sheet-label";

export const EXCEL_EMPTY = "(Пустые)";

export type ExcelCol =
  | "number"
  | "section"
  | "text"
  | "place"
  | "severity"
  | "verdict"
  | "comment";

export type ExcelColFilters = Partial<Record<ExcelCol, string[]>>;

function wording(review: Review): string {
  return (review.text || review.aiFinding).trim() || EXCEL_EMPTY;
}

function placeValues(review: Review): string[] {
  if (review.locations.length === 0) {
    if (review.needsRecheck) return ["нужно перепроверить"];
    if (review.origin !== "ai") return ["ждёт обогащения"];
    return ["—"];
  }
  return review.locations.map((location) =>
    [location.documentName || "без раздела", sheetLabel(location)].filter(Boolean).join(" · "),
  );
}

/** Значения ячейки — у «Где в ПД» их несколько, как несколько строк в Excel. */
export function excelColValues(review: Review, col: ExcelCol): string[] {
  switch (col) {
    case "number":
      return [String(review.number)];
    case "section":
      return [review.section.trim() || EXCEL_EMPTY];
    case "text":
      return [wording(review)];
    case "place":
      return placeValues(review);
    case "severity":
      return [REVIEW_SEVERITY_LABEL[review.severity]];
    case "verdict":
      return [REVIEW_VERDICT_LABEL[review.verdict]];
    case "comment":
      return [review.comment.trim() || EXCEL_EMPTY];
  }
}

export function excelColMatches(
  review: Review,
  col: ExcelCol,
  selected: string[],
): boolean {
  const allow = new Set(selected);
  return excelColValues(review, col).some((value) => allow.has(value));
}

export function applyExcelFilters(
  reviews: Review[],
  filters: ExcelColFilters,
): Review[] {
  return reviews.filter((item) => {
    for (const [col, selected] of Object.entries(filters) as [ExcelCol, string[]][]) {
      if (!selected) continue;
      if (selected.length === 0) return false;
      if (!excelColMatches(item, col, selected)) return false;
    }
    return true;
  });
}

/** Список значений колонки по строкам, которые проходят остальные фильтры. */
export function excelUniqueValues(
  reviews: Review[],
  col: ExcelCol,
  filters: ExcelColFilters,
): string[] {
  const others = { ...filters };
  delete others[col];
  const rows = applyExcelFilters(reviews, others);
  const seen = new Set<string>();
  for (const row of rows) {
    for (const value of excelColValues(row, col)) seen.add(value);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
}
