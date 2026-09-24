import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractObjectId,
  linkBlocksToRegions,
  omitEmptyPlacement,
  parseMarkdownBlocks,
  regionsFromCadTexts,
  renderedSheetBlocks,
  splitMarkdownSections,
  tidyVerbatim,
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

  it("shifts generated ids by offset", () => {
    const blocks = parseMarkdownBlocks("Первый абзац\n\nВторой абзац", 5);
    assert.deepEqual(
      blocks.map((block) => block.id),
      ["b-5", "b-6"],
    );
  });

  it("keeps obj ids untouched when offset is set", () => {
    const blocks = parseMarkdownBlocks("<!-- obj:H9 -->\nКолодец К-4", 3);
    assert.equal(blocks[0].id, "H9");
  });
});

describe("splitMarkdownSections", () => {
  const SHEET = [
    "## Страница 14",
    "",
    "# План сетей",
    "",
    "## Описание чертежа (модель, по изображению)",
    "",
    "Что где лежит на листе.",
    "",
    "## Состав листа (из геометрии)",
    "",
    "| Слой | Объектов |",
    "| --- | --- |",
    "| WALL | 495 |",
    "",
    "## Текст листа (из чертежа, дословно)",
    "",
    "Колодец К-4 — сливной колодец",
    "",
    "## Штамп",
    "",
    "| Поле | Значение |",
    "| --- | --- |",
    "| Лист | 14 |",
  ].join("\n");

  it("splits by h2 and keeps sheet title in the preamble", () => {
    const sections = splitMarkdownSections(SHEET);
    assert.deepEqual(
      sections.map((section) => section.title),
      [
        "",
        "Описание чертежа (модель, по изображению)",
        "Состав листа (из геометрии)",
        "Текст листа (из чертежа, дословно)",
        "Штамп",
      ],
    );
    assert.equal(sections[0].body, "# План сетей");
  });

  it("marks pipeline debug sections as service", () => {
    const service = splitMarkdownSections(SHEET)
      .filter((section) => section.service)
      .map((section) => section.title);
    assert.deepEqual(service, [
      "Состав листа (из геометрии)",
    ]);
  });

  it("не сворачивает таблицы листа, даже если в заголовке «по изображению»", () => {
    const sections = splitMarkdownSections(
      "## Таблицы листа (прочитаны моделью по изображению)\n\nтело",
    );
    assert.equal(sections[0]?.service, false);
  });

  it("drops an empty placement table and keeps a filled one", () => {
    const empty = omitEmptyPlacement(
      "**Что где на листе**\n\n| Блок | Где |\n|---|---|\n\nдальше",
    );
    assert.equal(empty.includes("Что где"), false);
    assert.equal(empty.includes("дальше"), true);
    const filled = omitEmptyPlacement(
      "**Что где на листе**\n\n| Блок | Где |\n|---|---|\n| штамп | справа |\n",
    );
    assert.equal(filled.includes("штамп"), true);
  });

  it("does not mark the sheet text and the stamp as service", () => {
    const sections = splitMarkdownSections(SHEET);
    const text = sections.find((s) => s.title.startsWith("Текст листа"));
    const stamp = sections.find((s) => s.title === "Штамп");
    assert.equal(text?.service, false);
    assert.equal(stamp?.service, false);
  });

  it("recognises reworded pipeline headings", () => {
    const sections = splitMarkdownSections(
      "## Карта листа\n\nтело\n\n## Состав листа по слоям\n\nтело",
    );
    assert.deepEqual(
      sections.map((section) => section.service),
      [true, true],
    );
  });

  /** Формулировки с прода: там свои заголовки, а дословный текст должен остаться. */
  it("recognises the headings the pipeline sends in production", () => {
    const sections = splitMarkdownSections(
      [
        "## Описание чертежа (модель, по изображению)",
        "тело",
        "## Геометрия листа (из векторов PDF, точно)",
        "тело",
        "## Лист дословно (из PDF, в порядке исходника)",
        "тело",
        "## Информация о листе",
        "size_pt: 842×1191 text_len: 1624",
      ].join("\n\n"),
    );
    assert.deepEqual(
      sections.map((section) => section.service),
      [false, true, false, true],
    );
  });

  /**
   * Главный риск этапа: если секции рендерить по отдельности без смещения,
   * нумерация b-N перезапустится и два блока листа получат один id.
   */
  it("gives every block of the sheet a unique id when rendered per section", () => {
    const sections = splitMarkdownSections(SHEET);
    const ids: string[] = [];
    let offset = 0;
    for (const section of sections) {
      const blocks = parseMarkdownBlocks(section.body, offset);
      for (const block of blocks) ids.push(block.id);
      offset += blocks.length;
    }
    assert.equal(new Set(ids).size, ids.length, `дубли в id: ${ids.join(",")}`);
  });

  it("collides without the offset — offset is what fixes it", () => {
    const sections = splitMarkdownSections(SHEET);
    const ids = sections.flatMap((section) =>
      parseMarkdownBlocks(section.body).map((block) => block.id),
    );
    assert.ok(new Set(ids).size < ids.length);
  });

  it("keeps the whole sheet when there are no h2 at all", () => {
    const sections = splitMarkdownSections("# Лист\n\nПросто текст");
    assert.equal(sections.length, 1);
    assert.equal(sections[0].title, "");
    assert.equal(sections[0].body, "# Лист\n\nПросто текст");
  });

  it("drops the sheet-number heading, keeps verbatim", () => {
    const sections = splitMarkdownSections(
      ["# Лист 1", "", "## Лист дословно", "", "текст штампа"].join("\n"),
    );
    assert.equal(
      sections.some((section) => section.body.includes("Лист 1")),
      false,
    );
    assert.equal(
      sections.some((section) => section.title.startsWith("Лист дословно")),
      true,
    );
  });
});

describe("renderedSheetBlocks", () => {
  it("keeps obj ids and does not restart numbering between sections", () => {
    const blocks = renderedSheetBlocks(
      [
        "# План",
        "",
        "## Текст листа (из чертежа, дословно)",
        "",
        "<!-- obj:7F3A -->",
        "Колодец К-4 — сливной колодец",
        "",
        "## Штамп",
        "",
        "Шифр комплекта 2024-118-АР5",
      ].join("\n"),
    );
    const well = blocks.find((block) => block.objId === "7F3A");
    assert.equal(well?.id, "7F3A");
    const ids = blocks.map((block) => block.id);
    assert.equal(new Set(ids).size, ids.length);
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

describe("tidyVerbatim", () => {
  it("склеивает повтор коротких строк и говорит, сколько раз", () => {
    const row = ["ПСВ", "ОП-5", "АПС", "Ду15", "220В", "Св.", "ИПР", "Кран"].join(
      "\n",
    );
    const body = [row, row, row].join("\n\n");
    const next = tidyVerbatim(body);
    assert.match(next, /^ПСВ ОП-5 АПС Ду15 220В Св\. ИПР Кран/);
    assert.match(next, /ещё 2 раза/);
    assert.equal(next.split("ПСВ").length - 1, 1);
  });

  it("не трогает обычный абзац", () => {
    const body = "площадь квартиры 105 равна 38.4 м2 по обмеру квартира 105 равна 42.1 м2";
    assert.equal(tidyVerbatim(body), body);
  });
});
