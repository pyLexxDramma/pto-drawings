import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchEngineerReview } from "../src/lib/review-annotation.ts";
import type { PageAnnotation, Review, ReviewLocation } from "../src/types.ts";

function loc(patch: Partial<ReviewLocation> = {}): ReviewLocation {
  return {
    documentId: "doc-1",
    documentName: "ОВ1.pdf",
    pageNumber: 3,
    quote: "Неверный диаметр",
    ...patch,
  };
}

function review(patch: Partial<Review> & { id: string }): Review {
  return {
    projectId: "p1",
    number: 1,
    section: "",
    origin: "engineer",
    text: "Неверный диаметр",
    aiFinding: "",
    locations: [loc()],
    severity: "medium",
    verdict: "pending",
    comment: "",
    wrongReason: "",
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    authorId: "u1",
    authorName: "Инженер",
    ...patch,
  };
}

function note(patch: Partial<PageAnnotation> & { id: string }): PageAnnotation {
  return {
    pageNumber: 3,
    rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
    comment: "Неверный диаметр",
    expected: "",
    status: "open",
    userId: "u1",
    userName: "Инженер",
    createdAt: "2026-09-15T00:00:00.000Z",
    resolvedAt: null,
    reviewId: null,
    ...patch,
  };
}

describe("matchEngineerReview", () => {
  it("находит строку по reviewId", () => {
    const linked = review({ id: "r-link" });
    const other = review({ id: "r-other", text: "Другое" });
    const found = matchEngineerReview([other, linked], "doc-1", {
      reviewId: "r-link",
      pageNumber: 3,
      comment: "что угодно",
    });
    assert.equal(found?.id, "r-link");
  });

  it("для старых пометок без reviewId ищет по листу и тексту", () => {
    const item = review({ id: "r-old" });
    const found = matchEngineerReview([item], "doc-1", note({ id: "a1" }));
    assert.equal(found?.id, "r-old");
  });

  it("не трогает находки ИИ", () => {
    const ai = review({ id: "r-ai", origin: "ai" });
    const found = matchEngineerReview([ai], "doc-1", note({ id: "a1" }));
    assert.equal(found, null);
  });
});
