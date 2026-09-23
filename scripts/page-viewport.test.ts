import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeCadLabel } from "../src/lib/cad-geometry.ts";
import {
  HIGHLIGHT_CONTEXT,
  HIGHLIGHT_MAX_SCALE,
  highlightZoomScale,
  legibleFitScale,
  padHighlightRect,
} from "../src/lib/page-viewport.ts";

describe("padHighlightRect", () => {
  it("увеличивает крошечную рамку и держит центр", () => {
    const next = padHighlightRect({ x: 0.9, y: 0.93, w: 0.012, h: 0.0024 });
    assert.ok(next.w >= 0.14);
    assert.ok(next.h >= 0.12);
    assert.ok(next.x + next.w <= 1.0001);
    assert.ok(next.y + next.h <= 1.0001);
  });
});

describe("legibleFitScale", () => {
  it("не увеличивает лист, если по ширине подпись уже читается", () => {
    assert.equal(legibleFitScale(1.07, 7.2), 1.07);
  });

  it("на А1 поднимает мелкую подпись до читаемой", () => {
    const scale = legibleFitScale(0.2, 2);
    assert.ok(scale > 0.2);
    assert.equal(scale, 11 / 2);
  });

  it("длинная строка держит масштаб, чтобы заголовок не обрезался", () => {
    assert.equal(legibleFitScale(0.2, 7.2, 0, 0.4), 0.4);
  });

  it("короткая подпись не ограничивает зум шириной строки", () => {
    assert.equal(legibleFitScale(0.2, 2, 0, 8), 11 / 2);
  });
});

describe("highlightZoomScale", () => {
  it("не даёт прыгнуть к 500%", () => {
    assert.ok(highlightZoomScale(5.11) <= HIGHLIGHT_MAX_SCALE);
    assert.equal(highlightZoomScale(2), 2 / HIGHLIGHT_CONTEXT);
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
