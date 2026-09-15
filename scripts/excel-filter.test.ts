import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyExcelFilters,
  excelUniqueValues,
  type ExcelColFilters,
} from "../src/lib/excel-filter.ts";
import type { Review, ReviewLocation } from "../src/types.ts";

function loc(documentName: string, pageNumber: number): ReviewLocation {
  return { documentId: null, documentName, pageNumber, quote: "" };
}

function review(patch: Partial<Review> & { id: string }): Review {
  return {
    projectId: "p1",
    number: 1,
    section: "ПЗ",
    origin: "ai",
    text: "Замечание",
    aiFinding: "",
    locations: [loc("ОВ1.pdf", 3)],
    severity: "medium",
    verdict: "pending",
    comment: "",
    wrongReason: "",
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    authorId: null,
    authorName: null,
    ...patch,
  };
}

describe("applyExcelFilters", () => {
  const rows = [
    review({ id: "a", number: 1, section: "ПЗ", severity: "high", verdict: "pending" }),
    review({ id: "b", number: 2, section: "ПБ", severity: "low", verdict: "confirmed" }),
    review({ id: "c", number: 3, section: "ПЗ", severity: "high", verdict: "confirmed" }),
  ];

  it("несколько колонок работают как И", () => {
    const filters: ExcelColFilters = {
      section: ["ПЗ"],
      severity: ["Высокий"],
    };
    assert.deepEqual(
      applyExcelFilters(rows, filters).map((item) => item.id),
      ["a", "c"],
    );
  });

  it("галочки в одной колонке — ИЛИ", () => {
    const filters: ExcelColFilters = { section: ["ПЗ", "ПБ"] };
    assert.equal(applyExcelFilters(rows, filters).length, 3);
  });

  it("пустой список галочек скрывает все строки", () => {
    assert.equal(applyExcelFilters(rows, { section: [] }).length, 0);
  });
});

describe("excelUniqueValues", () => {
  it("список колонки учитывает остальные фильтры", () => {
    const rows = [
      review({ id: "a", section: "ПЗ", severity: "high" }),
      review({ id: "b", section: "ПБ", severity: "low" }),
    ];
    const values = excelUniqueValues(rows, "severity", { section: ["ПЗ"] });
    assert.deepEqual(values, ["Высокий"]);
  });
});
