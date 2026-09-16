import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SITE_DOWN_AFTER_MS,
  isSiteDown,
  markSiteProbe,
  siteAnswered,
} from "../src/lib/site-watchdog.ts";

describe("site-watchdog", () => {
  it("200 — сайт жив, 502 и сеть — нет", () => {
    assert.equal(siteAnswered(true, 200), true);
    assert.equal(siteAnswered(true, 401), true);
    assert.equal(siteAnswered(false, 502), false);
    assert.equal(siteAnswered(false, null), false);
  });

  it("засекает первое падение и сбрасывает после ответа", () => {
    assert.equal(markSiteProbe(null, false, 1000), 1000);
    assert.equal(markSiteProbe(1000, false, 2000), 1000);
    assert.equal(markSiteProbe(1000, true, 3000), null);
  });

  it("плашка только после 30 с молчания", () => {
    assert.equal(isSiteDown(null, 40_000), false);
    assert.equal(isSiteDown(10_000, 39_999), false);
    assert.equal(isSiteDown(10_000, 10_000 + SITE_DOWN_AFTER_MS), true);
  });
});
