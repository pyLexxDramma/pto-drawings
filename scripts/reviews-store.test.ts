import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

// DATA_ROOT читается при загрузке модуля, поэтому импорт только после подмены.
let store: typeof import("../src/lib/reviews.ts");
let root = "";

const PROJECT = "df97da8f-1111-4222-8333-444444444444";

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "pto-reviews-"));
  process.env.DATA_ROOT = root;
  store = await import("../src/lib/reviews.ts");
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

function finding(text: string, page: number | null = 919) {
  return {
    section: "ПБ",
    aiFinding: text,
    severity: "high" as const,
    locations: [
      {
        documentId: null,
        documentName: "Раздел ПД №9 (ПБ)",
        pageNumber: page,
        quote: "310 м³",
      },
    ],
  };
}

describe("ingestReviews", () => {
  it("добавляет пачку и нумерует подряд", async () => {
    const result = await store.ingestReviews(PROJECT, [
      finding("Объём резервуара расходится"),
      finding("Расход на внутреннее пожаротушение не сходится", 920),
    ]);
    assert.deepEqual(result, { added: 2, updated: 0, total: 2 });

    const list = await store.listReviews(PROJECT);
    assert.deepEqual(
      list.map((item) => item.number),
      [1, 2],
    );
  });

  it("повторный прогон не плодит дубли", async () => {
    const result = await store.ingestReviews(PROJECT, [
      finding("Объём резервуара расходится"),
    ]);
    assert.equal(result.added, 0);
    assert.equal(result.updated, 1);
    assert.equal(result.total, 2);
  });

  it("отбрасывает замечания без обоснования", async () => {
    const result = await store.ingestReviews(PROJECT, [
      { section: "ПБ", aiFinding: "   " },
    ]);
    assert.deepEqual(result, { added: 0, updated: 0, total: 2 });
  });

  it("не сбрасывает разбор с заказчиком при повторном прогоне", async () => {
    const before = await store.listReviews(PROJECT);
    const target = before[0];

    await store.updateReview(PROJECT, target.id, {
      verdict: "confirmed",
      comment: "Владимир Михайлович подтвердил, отдаём проектировщикам",
      severity: "low",
    });

    await store.ingestReviews(PROJECT, [finding("Объём резервуара расходится")]);

    const after = await store.listReviews(PROJECT);
    const same = after.find((item) => item.id === target.id);
    assert.ok(same);
    assert.equal(same.verdict, "confirmed");
    assert.equal(
      same.comment,
      "Владимир Михайлович подтвердил, отдаём проектировщикам",
    );
    // Важность после разбора конвейер не перебивает.
    assert.equal(same.severity, "low");
  });

  it("помечает совпадение клиента и ИИ", async () => {
    const own = await store.createReview(PROJECT, {
      section: "ПЗУ",
      text: "Площадь застройки КПП не сходится",
      aiFinding: "Площадь застройки КПП не сходится",
      locations: [
        {
          documentId: null,
          documentName: "Раздел ПД №2 (ПЗУ)",
          pageNumber: 21,
          quote: "37.10",
        },
      ],
    });
    assert.equal(own.origin, "engineer");

    await store.ingestReviews(PROJECT, [
      {
        section: "ПЗУ",
        aiFinding: "Площадь застройки КПП не сходится",
        locations: [
          {
            documentId: null,
            documentName: "Раздел ПД №2 (ПЗУ)",
            pageNumber: 21,
            quote: "37.10",
          },
        ],
      },
    ]);

    const list = await store.listReviews(PROJECT);
    const merged = list.find((item) => item.id === own.id);
    assert.ok(merged);
    assert.equal(merged.origin, "both");
  });

  it("удаляет замечание и пересчитывает номера", async () => {
    const list = await store.listReviews(PROJECT);
    const removed = await store.deleteReview(PROJECT, list[0].id);
    assert.equal(removed, true);

    const after = await store.listReviews(PROJECT);
    assert.equal(after.length, list.length - 1);
    assert.deepEqual(
      after.map((item) => item.number),
      after.map((_, index) => index + 1),
    );
    assert.equal(await store.deleteReview(PROJECT, list[0].id), false);
  });

  it("пустой проект отдаёт пустой список", async () => {
    const list = await store.listReviews("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    assert.deepEqual(list, []);
  });
});
