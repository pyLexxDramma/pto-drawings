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

  it("shows drawing-miss only after an explicit zero from the viewer", () => {
    assert.equal(
      quoteBannerKind({
        bannerOn: true,
        focusDrawing: true,
        textHitFound: true,
        drawingHitCount: 0,
      }),
      "miss-drawing",
    );
  });
});
