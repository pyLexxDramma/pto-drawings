import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import { buildXlsx } from "../src/lib/xlsx.ts";
import {
  buildReviewsXlsx,
  exportableReviews,
  reviewsFileName,
} from "../src/lib/reviews-export.ts";
import { sortReviews } from "../src/lib/reviews.ts";
import { CROSS_FILE_GROUP, groupReviews } from "../src/lib/reviews-group.ts";
import type { Review, ReviewLocation, ReviewSeverity } from "../src/types.ts";

function loc(documentName: string, pageNumber: number): ReviewLocation {
  return { documentId: null, documentName, pageNumber, quote: "" };
}

function review(patch: Partial<Review> & { id: string }): Review {
  return {
    projectId: "p1",
    number: 0,
    section: "ПЗ",
    origin: "ai",
    text: "",
    aiFinding: "находка",
    locations: [],
    severity: "medium",
    verdict: "pending",
    comment: "",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    authorId: null,
    authorName: null,
    ...patch,
  };
}

function parts(file: Buffer): Record<string, string> {
  const entries = unzipSync(new Uint8Array(file));
  return Object.fromEntries(
    Object.entries(entries).map(([name, data]) => [name, strFromU8(data)]),
  );
}

describe("buildXlsx", () => {
  it("собирает валидный минимальный пакет OOXML", () => {
    const file = buildXlsx({
      name: "Замечания",
      columns: [6, 40],
      rows: [
        [{ value: "№", bold: true }, { value: "Замечание", bold: true }],
        [{ value: 1 }, { value: "Кириллица «в кавычках» & <тег>", wrap: true }],
      ],
      freezeHeader: true,
    });

    const files = parts(file);
    for (const required of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]) {
      assert.ok(files[required], `нет части ${required}`);
    }

    const sheet = files["xl/worksheets/sheet1.xml"];
    assert.match(sheet, /<c r="A2" s="0"><v>1<\/v><\/c>/);
    assert.match(sheet, /Кириллица «в кавычках» &amp; &lt;тег&gt;/);
    assert.match(sheet, /state="frozen"/);

    // Индексы стилей не должны выходить за cellXfs.
    const declared = Number(
      files["xl/styles.xml"].match(/<cellXfs count="(\d+)"/)?.[1] ?? "0",
    );
    const used = [...sheet.matchAll(/ s="(\d+)"/g)].map((m) => Number(m[1]));
    assert.ok(declared > 0);
    for (const index of used) assert.ok(index < declared, `стиль ${index}`);
  });

  it("не роняет XML на управляющих символах", () => {
    const files = parts(
      buildXlsx({
        name: "S",
        columns: [10],
        rows: [[{ value: "до\u0007после" }]],
      }),
    );
    assert.match(files["xl/worksheets/sheet1.xml"], /допосле/);
  });
});

describe("exportableReviews", () => {
  it("выкидывает «Не нужно» и держит порядок раздел → важность", () => {
    const items = [
      review({ id: "a", section: "ПБ", severity: "low" }),
      review({ id: "b", section: "ПЗ", severity: "skip" }),
      review({ id: "c", section: "ПБ", severity: "high" }),
      review({ id: "d", section: "ПЗ", severity: "medium" }),
    ];
    const out = exportableReviews(items).map((item) => item.id);
    assert.deepEqual(out, ["d", "c", "a"]);
  });

  it("нумерует подряд после отбрасывания «Не нужно»", () => {
    const file = buildReviewsXlsx({
      projectName: "Жуковский 1",
      reviews: [
        review({ id: "a", section: "ПЗ", severity: "skip", text: "мимо" }),
        review({ id: "b", section: "ПЗ", severity: "high", text: "первое" }),
        review({ id: "c", section: "ПБ", severity: "high", text: "второе" }),
      ],
    });
    const sheet = parts(file)["xl/worksheets/sheet1.xml"];
    assert.match(sheet, /<c r="A2" s="4"><v>1<\/v><\/c>/);
    assert.match(sheet, /<c r="A3" s="4"><v>2<\/v><\/c>/);
    assert.ok(!sheet.includes("мимо"));
    assert.match(sheet, /первое/);
    assert.match(sheet, /второе/);
    assert.ok(!sheet.includes('r="A4"'));
  });
});

describe("buildReviewsXlsx", () => {
  it("отдаёт официальные 4 колонки и место в ПД с цитатой", () => {
    const file = buildReviewsXlsx({
      projectName: "Жуковский 1",
      reviews: [
        review({
          id: "a",
          section: "ПБ",
          severity: "high",
          aiFinding: "Объём резервуара расходится",
          locations: [
            {
              documentId: null,
              documentName: "Раздел ПД №9 (ПБ)",
              pageNumber: 919,
              quote: "2 резервуара, объёмом 310 м³",
            },
            {
              documentId: null,
              documentName: "Раздел ПД №9 (ПБ)",
              pageNumber: 4089,
              quote: "250 м³",
            },
          ],
        }),
      ],
    });

    const sheet = parts(file)["xl/worksheets/sheet1.xml"];
    assert.match(sheet, /Где в ПД/);
    assert.ok(!sheet.includes('r="E1"'), "лишних колонок быть не должно");
    // Формулировки инженера нет — берём обоснование ИИ.
    assert.match(sheet, /Объём резервуара расходится/);
    assert.match(sheet, /стр. 919/);
    assert.match(sheet, /стр. 4089/);
  });

  it("красит строки по важности", () => {
    const fills: Record<ReviewSeverity, string> = {
      high: "4",
      medium: "8",
      low: "12",
      skip: "0",
    };
    for (const severity of ["high", "medium", "low"] as ReviewSeverity[]) {
      const sheet = parts(
        buildReviewsXlsx({
          projectName: "P",
          reviews: [review({ id: "x", severity, text: "т" })],
        }),
      )["xl/worksheets/sheet1.xml"];
      assert.match(
        sheet,
        new RegExp(`<c r="A2" s="${fills[severity]}">`),
        `важность ${severity}`,
      );
    }
  });
});

describe("sortReviews", () => {
  it("известные разделы, за ними незнакомые, межраздел последним", () => {
    const out = sortReviews([
      review({ id: "m", section: "межраздел" }),
      review({ id: "x", section: "ХЗ" }),
      review({ id: "p", section: "ПЗ" }),
    ]).map((item) => item.id);
    assert.deepEqual(out, ["p", "x", "m"]);
  });
});

describe("groupReviews", () => {
  const items = [
    review({
      id: "pb-low",
      section: "ПБ",
      severity: "low",
      locations: [loc("Раздел ПД №9 (ПБ)", 919)],
    }),
    review({
      id: "pz-high",
      section: "ПЗ",
      severity: "high",
      locations: [loc("Раздел ПД №1 (ПЗ)", 21)],
    }),
    review({
      id: "cross",
      section: "межраздел",
      severity: "high",
      locations: [loc("Раздел ПД №1 (ПЗ)", 21), loc("Раздел ПД №9 (ПБ)", 919)],
    }),
    review({
      id: "pb-high",
      section: "ПБ",
      severity: "high",
      locations: [loc("Раздел ПД №9 (ПБ)", 4089)],
    }),
  ];

  it("по разделам держит порядок с сервера", () => {
    const groups = groupReviews(items, "section");
    assert.deepEqual(
      groups.map((group) => group.key),
      ["ПБ", "ПЗ", "межраздел"],
    );
  });

  it("по файлам сводит разные разделы одного файла в одну группу", () => {
    const groups = groupReviews(items, "file");
    assert.deepEqual(
      groups.map((group) => group.key),
      ["Раздел ПД №9 (ПБ)", "Раздел ПД №1 (ПЗ)", CROSS_FILE_GROUP],
    );
    assert.deepEqual(
      groups[0].items.map((item) => item.id),
      ["pb-high", "pb-low"],
    );
  });

  it("замечание на двух файлах уходит в сборную группу в конце", () => {
    const groups = groupReviews(items, "file");
    const last = groups[groups.length - 1];
    assert.equal(last.key, CROSS_FILE_GROUP);
    assert.deepEqual(
      last.items.map((item) => item.id),
      ["cross"],
    );
  });

  it("замечание без локаций тоже попадает в сборную группу", () => {
    const groups = groupReviews(
      [review({ id: "bare", section: "АР5", locations: [] })],
      "file",
    );
    assert.deepEqual(
      groups.map((group) => group.key),
      [CROSS_FILE_GROUP],
    );
  });

  it("внутри группы важное сверху", () => {
    const groups = groupReviews(
      [
        review({ id: "a", section: "ПБ", severity: "skip" }),
        review({ id: "b", section: "ПБ", severity: "high" }),
        review({ id: "c", section: "ПБ", severity: "medium" }),
      ],
      "section",
    );
    assert.deepEqual(
      groups[0].items.map((item) => item.id),
      ["b", "c", "a"],
    );
  });

  it("не теряет и не дублирует замечания", () => {
    for (const mode of ["section", "file"] as const) {
      const flat = groupReviews(items, mode).flatMap((group) => group.items);
      assert.equal(flat.length, items.length, mode);
      assert.equal(new Set(flat.map((item) => item.id)).size, items.length, mode);
    }
  });
});

describe("reviewsFileName", () => {
  it("чистит запрещённые в имени символы", () => {
    assert.match(reviewsFileName('Жук/ов:ский*1'), /^Жуковский1 — замечания \d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
