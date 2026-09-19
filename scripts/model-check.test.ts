import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildModelCheck } from "../src/lib/model-check.ts";

describe("buildModelCheck", () => {
  it("не показывает значок на чистом CAD-листе", () => {
    const check = buildModelCheck({
      pageNumber: 1,
      source: "heuristic",
      warnings: [],
      reviewCount: 2,
    });
    assert.equal(check.count, 0);
  });

  it("раскладывает плашки модели по вкладкам", () => {
    const check = buildModelCheck({
      pageNumber: 2,
      source: "model",
      warnings: [
        "скан: текстового слоя нет",
        "марки в описании отличаются от документа: A2 (в слое: K2)",
      ],
      numbers: {
        checked: true,
        total: 4,
        found: 2,
        precision: 0.5,
        suspect: ["24", "32"],
      },
      reviewCount: 0,
    });
    assert.ok(check.count > 0);
    const titles = check.sections.map((s) => s.id);
    assert.deepEqual(titles, ["source", "compare", "missed", "fix"]);
    assert.match(
      check.sections.find((s) => s.id === "compare")!.items.join(" "),
      /A2/,
    );
  });
});
