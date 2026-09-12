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
    assert.deepEqual(result, { added: 2, updated: 0, enriched: 0, total: 2 });

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
    assert.deepEqual(result, { added: 0, updated: 0, enriched: 0, total: 2 });
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

  it("дописывает путь в ПД к замечанию, заведённому руками", async () => {
    const own = await store.createReview(PROJECT, {
      section: "ИОС2",
      text: "Диаметр стояка К1 не сходится с аксонометрией",
    });
    assert.deepEqual(own.locations, []);
    assert.equal(own.aiFinding, "");

    const result = await store.ingestReviews(PROJECT, [
      {
        section: "ИОС2",
        severity: "high",
        aiFinding:
          "Диаметр стояка К1 расходится: на плане Ду 100, аксонометрия даёт Ду 150.",
        locations: [
          {
            documentId: "doc-ios2",
            documentName: "Раздел ПД №5 (ИОС2)",
            pageNumber: 77,
            quote: "Ду 100",
          },
        ],
      },
    ]);
    assert.equal(result.added, 0, "дубля быть не должно");
    assert.equal(result.enriched, 1);

    const list = await store.listReviews(PROJECT);
    const same = list.find((item) => item.id === own.id);
    assert.ok(same);
    assert.equal(same.origin, "both");
    // Формулировку инженера агент не перебивает.
    assert.equal(same.text, "Диаметр стояка К1 не сходится с аксонометрией");
    assert.match(same.aiFinding, /аксонометрия даёт Ду 150/);
    assert.equal(same.locations.length, 1);
    assert.equal(same.locations[0].pageNumber, 77);
    assert.equal(same.severity, "high");
  });

  it("не склеивает замечания из разных разделов", async () => {
    const own = await store.createReview(PROJECT, {
      section: "ПОС",
      text: "Ограждение стройплощадки не показано на схеме движения",
    });
    const result = await store.ingestReviews(PROJECT, [
      {
        section: "ОДИ",
        aiFinding:
          "Ограждение стройплощадки не показано на схеме движения транспорта",
        locations: [],
      },
    ]);
    assert.equal(result.enriched, 0);
    assert.equal(result.added, 1, "разные разделы — разные замечания");

    const list = await store.listReviews(PROJECT);
    assert.equal(list.find((item) => item.id === own.id)?.origin, "engineer");
  });

  it("не склеивает замечания про разное в одном разделе", async () => {
    const before = (await store.listReviews(PROJECT)).length;
    const result = await store.ingestReviews(PROJECT, [
      {
        section: "ПОС",
        aiFinding: "Календарный график не согласуется с ведомостью объёмов",
        locations: [],
      },
    ]);
    assert.equal(result.enriched, 0);
    assert.equal(result.added, 1);
    assert.equal((await store.listReviews(PROJECT)).length, before + 1);
  });

  it("одна находка цепляется только к одному ручному замечанию", async () => {
    const first = await store.createReview(PROJECT, {
      section: "ТБЭ",
      text: "Периодичность обследования конструкций не указана",
    });
    const second = await store.createReview(PROJECT, {
      section: "ТБЭ",
      text: "Периодичность обследования конструкций не указана",
    });
    const result = await store.ingestReviews(PROJECT, [
      {
        section: "ТБЭ",
        aiFinding:
          "Периодичность обследования несущих конструкций не указана в разделе",
        locations: [
          {
            documentId: "doc-tbe",
            documentName: "Раздел ПД №12 (ТБЭ)",
            pageNumber: 5,
            quote: "обследование",
          },
        ],
      },
    ]);
    assert.equal(result.enriched, 1);
    assert.equal(result.added, 0);

    const list = await store.listReviews(PROJECT);
    const enrichedCount = [first.id, second.id].filter(
      (id) => list.find((item) => item.id === id)?.origin === "both",
    ).length;
    assert.equal(enrichedCount, 1, "второе замечание должно остаться как было");
  });

  it("createReviews кладёт Excel в поток «инженер» и не дублирует", async () => {
    const first = await store.createReviews(
      PROJECT,
      [
        { section: "ОВ", text: "Диаметр ВСХ-20 не сходится", severity: "high" },
        { section: "ОВ", text: "Диаметр ВСХ-20 не сходится", severity: "low" },
        { section: "ВК", text: "  " },
      ],
      { userId: "u-imp", userName: "Импорт" },
    );
    assert.equal(first.added, 1);
    assert.equal(first.skipped, 2);
    assert.equal(first.reviews[0].origin, "engineer");
    assert.equal(first.reviews[0].needsRecheck, false);

    const again = await store.createReviews(
      PROJECT,
      [{ section: "ОВ", text: "Диаметр ВСХ-20 не сходится" }],
      { userId: "u-imp", userName: "Импорт" },
    );
    assert.equal(again.added, 0);
    assert.equal(again.skipped, 1);
  });

  it("обогащает строку по reviewId и не затирает текст инженера", async () => {
    const created = await store.createReviews(
      PROJECT,
      [{ section: "прочее", text: "Сырое замечание без раздела" }],
      { userId: "u-imp", userName: "Импорт" },
    );
    const own = created.reviews[0];
    const result = await store.ingestReviews(PROJECT, [
      {
        reviewId: own.id,
        section: "ОВ",
        aiFinding: "Диаметр ВСХ-20 на плане не сходится со спецификацией",
        needsRecheck: false,
        origin: "ai",
        locations: [
          {
            documentId: "doc-ov",
            documentName: "250910-ВА-Р-ОВ1",
            pageNumber: 12,
            quote: "ВСХ-20",
          },
        ],
      },
    ]);
    assert.equal(result.enriched, 1);
    assert.equal(result.added, 0);

    const same = (await store.listReviews(PROJECT)).find((item) => item.id === own.id);
    assert.equal(same?.origin, "both");
    assert.equal(same?.text, "Сырое замечание без раздела");
    assert.equal(same?.section, "ОВ");
    assert.equal(same?.needsRecheck, false);
    assert.equal(same?.locations[0]?.pageNumber, 12);
  });

  it("needsRecheck остаётся, если цитату не нашли", async () => {
    const created = await store.createReviews(
      PROJECT,
      [{ section: "АР", text: "Площадь КПП не сходится" }],
      { userId: "u-imp", userName: "Импорт" },
    );
    const own = created.reviews[0];
    await store.ingestReviews(PROJECT, [
      {
        reviewId: own.id,
        section: "АР",
        needsRecheck: true,
        locations: [],
      },
    ]);
    const same = (await store.listReviews(PROJECT)).find((item) => item.id === own.id);
    assert.equal(same?.needsRecheck, true);
    assert.equal(same?.text, "Площадь КПП не сходится");
    assert.deepEqual(same?.locations, []);
  });

  it("склеивает по шифрам и числам, которые короче слова", async () => {
    const own = await store.createReview(PROJECT, {
      section: "ОВ",
      text: "Нагрузка на калорифер П1 не сходится: 42.5 против 38.2",
    });
    const result = await store.ingestReviews(PROJECT, [
      {
        section: "ОВ",
        aiFinding:
          "Нагрузка калорифера П1 в спецификации 38.2 кВт, в расчёте 42.5 кВт",
        locations: [
          {
            documentId: "doc-ov",
            documentName: "250910-ВА-Р-ОВ1",
            pageNumber: 4,
            quote: "42.5 кВт",
          },
        ],
      },
    ]);
    assert.equal(result.enriched, 1);
    assert.equal(result.added, 0);

    const same = (await store.listReviews(PROJECT)).find(
      (item) => item.id === own.id,
    );
    assert.equal(same?.origin, "both");
    assert.equal(same?.locations[0]?.pageNumber, 4);
  });

  it("незнакомые разделы идут по появлению, межраздел последним", async () => {
    const project = "df97da8f-2222-4222-8333-444444444444";
    await store.ingestReviews(project, [
      { section: "межраздел", aiFinding: "Отметки 0.000 расходятся" },
      { section: "250910-ВА-Р-ОВ1", aiFinding: "Нет расхода приточки" },
      { section: "ИОС2", aiFinding: "Диаметр стояка не сходится" },
      { section: "250910-ВА-Р-ВК1", aiFinding: "Нет уклона выпуска" },
    ]);

    const list = await store.listReviews(project);
    assert.deepEqual(
      list.map((item) => item.section),
      ["ИОС2", "250910-ВА-Р-ОВ1", "250910-ВА-Р-ВК1", "межраздел"],
    );
  });

  it("марки рабочей документации идут составом тома", async () => {
    const project = "df97da8f-3333-4222-8333-444444444444";
    await store.ingestReviews(project, [
      { section: "ЭО", aiFinding: "Нет селективности защит" },
      { section: "АР", aiFinding: "Узел примыкания не показан" },
      { section: "ОВ", aiFinding: "Расход приточки не сходится" },
      { section: "КЖ", aiFinding: "Класс бетона не указан" },
    ]);

    const list = await store.listReviews(project);
    assert.deepEqual(
      list.map((item) => item.section),
      ["АР", "КЖ", "ОВ", "ЭО"],
    );
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

describe("журнал разбора", () => {
  const project = "df97da8f-4444-4222-8333-444444444444";

  it("пишет, кто менял важность, разбор и комментарий", async () => {
    await store.ingestReviews(project, [
      { section: "ОВ", aiFinding: "Расход приточки не сходится" },
    ]);
    const [review] = await store.listReviews(project);

    await store.updateReview(
      project,
      review.id,
      { severity: "high", comment: "спросить у ОВ" },
      { userId: "u-1", userName: "Темников Алексей" },
    );

    const events = await store.listReviewEvents(project);
    const fields = events.map((item) => item.field);
    assert.ok(fields.includes("severity"));
    assert.ok(fields.includes("comment"));
    const severity = events.find((item) => item.field === "severity");
    assert.equal(severity?.from, "medium");
    assert.equal(severity?.to, "high");
    assert.equal(severity?.userName, "Темников Алексей");
  });

  it("причина брака живёт только при вердикте «Неверно»", async () => {
    const [review] = await store.listReviews(project);

    const wrong = await store.updateReview(
      project,
      review.id,
      { verdict: "wrong", wrongReason: "Такого в чертеже нет" },
      { userId: "u-1", userName: "Темников Алексей" },
    );
    assert.equal(wrong?.verdict, "wrong");
    assert.equal(wrong?.wrongReason, "Такого в чертеже нет");

    const events = await store.listReviewEvents(project);
    const verdict = events.find((item) => item.field === "verdict");
    assert.match(verdict?.to ?? "", /Такого в чертеже нет/);

    const back = await store.updateReview(project, review.id, {
      verdict: "confirmed",
    });
    assert.equal(back?.wrongReason, "", "причина не должна переезжать в другой статус");
  });

  it("удаление тоже попадает в журнал", async () => {
    const [review] = await store.listReviews(project);
    await store.deleteReview(project, review.id, {
      userId: "u-2",
      userName: "Дархан",
    });
    const events = await store.listReviewEvents(project);
    const removed = events.find((item) => item.field === "deleted");
    assert.equal(removed?.userName, "Дархан");
  });
});
