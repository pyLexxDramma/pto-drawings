import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeCadLabel } from "../src/lib/cad-geometry.ts";
import { padHighlightRect } from "../src/lib/page-viewport.ts";

describe("padHighlightRect", () => {
  it("увеличивает крошечную рамку и держит центр", () => {
    const next = padHighlightRect({ x: 0.9, y: 0.93, w: 0.012, h: 0.0024 });
    assert.ok(next.w >= 0.06);
    assert.ok(next.h >= 0.05);
    assert.ok(next.x + next.w <= 1.0001);
    assert.ok(next.y + next.h <= 1.0001);
  });
});

describe("decodeCadLabel", () => {
  it("не ломает уже кириллицу", () => {
    assert.equal(decodeCadLabel("площадь 2450"), "площадь 2450");
  });

  it("собирает cp1251, прочитанный как latin1", () => {
    const asLatin = Buffer.from([0xef, 0xeb, 0xee, 0xf9, 0xe0, 0xe4, 0xfc]).toString(
      "latin1",
    );
    assert.equal(decodeCadLabel(asLatin), "площадь");
  });
});
