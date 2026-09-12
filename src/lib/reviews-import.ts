import type { ReviewSeverity } from "@/types";

export type ImportedEngineerRemark = {
  text: string;
  section: string;
  severity: ReviewSeverity;
};

const TEXT_KEYS = [
  "замечание",
  "формулировка",
  "текст",
  "описание",
  "comment",
  "remark",
  "замечания",
];
const SECTION_KEYS = ["раздел", "section", "марка", "том"];
const SEVERITY_KEYS = ["важность", "severity", "приоритет"];

const SEVERITY_ALIASES: Record<string, ReviewSeverity> = {
  высокий: "high",
  высокая: "high",
  high: "high",
  средний: "medium",
  средняя: "medium",
  medium: "medium",
  низкий: "low",
  низкая: "low",
  low: "low",
  "не нужно": "skip",
  skip: "skip",
};

function norm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function headerIndex(header: string[], keys: string[]): number {
  return header.findIndex((cell) => keys.includes(norm(cell)));
}

function parseSeverity(raw: string): ReviewSeverity {
  return SEVERITY_ALIASES[norm(raw)] ?? "medium";
}

/**
 * Сырой Excel инженера: ищем колонку с формулировкой, раздел и важность
 * необязательны. Без шапки берём первую непустую колонку как текст.
 */
export function parseEngineerRemarks(rows: string[][]): ImportedEngineerRemark[] {
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.trim());
  const textCol = headerIndex(header, TEXT_KEYS);
  const hasHeader = textCol >= 0;
  const sectionCol = hasHeader ? headerIndex(header, SECTION_KEYS) : -1;
  const severityCol = hasHeader ? headerIndex(header, SEVERITY_KEYS) : -1;
  const body = hasHeader ? rows.slice(1) : rows;
  const fallbackTextCol = hasHeader
    ? textCol
    : header.findIndex((cell) => cell.trim()) >= 0
      ? 0
      : 0;

  const out: ImportedEngineerRemark[] = [];
  for (const row of body) {
    const text = (row[fallbackTextCol] ?? "").trim();
    if (!text) continue;
    if (hasHeader && TEXT_KEYS.includes(norm(text))) continue;
    out.push({
      text,
      section: (sectionCol >= 0 ? row[sectionCol] : "")?.trim() || "прочее",
      severity: parseSeverity(severityCol >= 0 ? (row[severityCol] ?? "") : ""),
    });
  }
  return out;
}
