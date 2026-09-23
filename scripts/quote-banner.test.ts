import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quoteBannerKind } from "../src/lib/quote-banner.ts";

describe("quoteBannerKind", () => {
  it("hides after drawing search finds a hit (Danil: найдено 1)", () => {
    assert.equal(
      quoteBannerKind({
        bannerOn: true,
        focusDrawing: true,
        textHitFound: true,
        drawingHitCount: 1,
      }),
      null,
    );
  });

  it("does not claim a drawing miss while the viewer has not reported", () => {
    assert.equal(
      quoteBannerKind({
        bannerOn: true,
        focusDrawing: true,
        textHitFound: true,
        drawingHitCount: null,
      }),
      null,
    );
  });

  it("hides when the text was found even if the drawing count is zero", () => {
    assert.equal(
      quoteBannerKind({
        bannerOn: true,
        focusDrawing: true,
        textHitFound: true,
        drawingHitCount: 0,
      }),
      null,
    );
  });

  it("hides while either side has not answered", () => {
    assert.equal(
      quoteBannerKind({
        bannerOn: true,
        focusDrawing: true,
        textHitFound: null,
        drawingHitCount: 0,
      }),
      null,
    );
  });

  it("shows only when both drawing and text said no", () => {
    assert.equal(
      quoteBannerKind({
        bannerOn: true,
        focusDrawing: true,
        textHitFound: false,
        drawingHitCount: 0,
      }),
      "miss-both",
    );
  });

  it("hides when a highlight rect is already on the sheet", () => {
    assert.equal(
      quoteBannerKind({
        bannerOn: true,
        focusDrawing: true,
        textHitFound: false,
        drawingHitCount: 0,
        highlighted: true,
      }),
      null,
    );
  });
});
