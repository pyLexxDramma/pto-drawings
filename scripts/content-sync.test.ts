import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractObjectId,
  linkBlocksToRegions,
  parseMarkdownBlocks,
  regionsFromCadTexts,
} from "../src/lib/content-sync.ts";

describe("extractObjectId", () => {
  it("parses obj comment", () => {
    const { objId, source } = extractObjectId(
      "<!-- obj:ABC-42 -->\nКолодец К-4",
    );
    assert.equal(objId, "ABC-42");
    assert.equal(source, "Колодец К-4");
  });
});

describe("parseMarkdownBlocks", () => {
  it("uses obj id as block id", () => {
    const blocks = parseMarkdownBlocks(
      "<!-- obj:H1 -->\nКолодец К-4\n\n<!-- obj:H2 -->\nТруба Ду 200",
    );
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].id, "H1");
    assert.equal(blocks[0].objId, "H1");
    assert.equal(blocks[1].objId, "H2");
  });
});

describe("linkBlocksToRegions", () => {
  it("links by objId before fuzzy text", () => {
    const blocks = parseMarkdownBlocks(
      "<!-- obj:match -->\nКолодец К-4 — drain pit\n\nДругой текст совсем",
    );
    const regions = regionsFromCadTexts(
      [
        {
          id: "match",
          text: "Колодец К-4",
          points: [100, 200],
          size: 2.5,
        },
        {
          id: "other",
          text: "Другой текст совсем",
          points: [100, 180],
          size: 2.5,
        },
      ],
      { x0: 0, y0: 0, x1: 400, y1: 300 },
    );
    const links = linkBlocksToRegions(blocks, regions);
    const linked = links.byBlock.get("match");
    assert.ok(linked);
    assert.equal(linked?.objId, "match");
    assert.match(linked?.text ?? "", /колодец к 4/);
  });

  it("does not positional-fallback mismatched blocks", () => {
    const blocks = parseMarkdownBlocks("Альфа блок\n\nБета блок");
    const regions = regionsFromCadTexts(
      [
        { text: "Гамма подпись", points: [50, 250], size: 3 },
        { text: "Дельта подпись", points: [50, 220], size: 3 },
      ],
      { x0: 0, y0: 0, x1: 400, y1: 300 },
    );
    const links = linkBlocksToRegions(blocks, regions);
    assert.equal(links.byBlock.size, 0);
  });
});
