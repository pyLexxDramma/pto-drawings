/**
 * Демо-данные для показа таблицы замечаний, пока конвейер не отдаёт находки.
 * Пишет прямо в локальное хранилище (data/), сервер запускать не нужно:
 *
 *   npx --yes tsx scripts/demo-seed.ts
 *
 * Собирает проект «Жуковский 1 — демо (ПТО)»: реальные листы ИОС2 из
 * «страницы для тестов», расшифровка, замечания всех трёх потоков и частично
 * разобранный с заказчиком статус. Повторный запуск пересоздаёт проект.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

const PROJECT_NAME = "Жуковский 1 — демо (ПТО)";
/** Настоящие листы ИОС2 лежат рядом с репозиторием, по одному PDF на лист. */
const PAGES_DIR = path.resolve("..", "страницы для тестов");
const SAMPLES_DIR = path.resolve("samples");
const IOS2_PAGES = 20;

const storage = await import("../src/lib/storage.ts");
const reviews = await import("../src/lib/reviews.ts");

// --------------------------------------------------------------- исходные PDF

/** Склеиваем отдельные листы в один раздел — так его и присылает заказчик. */
async function mergeIos2(): Promise<Buffer> {
  const files = (await readdir(PAGES_DIR))
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => ({
      name,
      page: Number(name.match(/-(\d+)\.pdf$/i)?.[1] ?? 0),
    }))
    .filter((item) => item.page >= 1 && item.page <= IOS2_PAGES)
    .sort((a, b) => a.page - b.page);

  const merged = await PDFDocument.create();
  for (const file of files) {
    const raw = await readFile(path.join(PAGES_DIR, file.name));
    const source = await PDFDocument.load(raw, { ignoreEncryption: true });
    const copied = await merged.copyPages(source, source.getPageIndices());
    for (const page of copied) merged.addPage(page);
  }
  return Buffer.from(await merged.save());
}

async function sample(name: string): Promise<Buffer> {
  return readFile(path.join(SAMPLES_DIR, name));
}

// ------------------------------------------------------------------ страницы

const IOS2_QUOTES: Record<number, string> = {
  3: "Узел ввода водопровода в осях 4–5 условно, без деталировки",
  5: "Уклон самотечного участка К1 принять по расчёту",
  7: "Внутреннее пожаротушение: 2 струи по 2,5 л/с",
  9: "Стояк К1 — Ø100",
  12: "Насосная установка на одну струю, Q = 2,5 л/с",
  14: "Стояк К1 — Ø150 (аксонометрия)",
  18: "Материал труб участка Т3 — по указанию",
};

function ios2Markdown(page: number): string {
  const quote = IOS2_QUOTES[page];
  return [
    `# Раздел ПД №5 Подраздел №2 (ИОС2) — лист ${page}`,
    "",
    "## Основные показатели",
    "",
    "| Показатель | Значение |",
    "| --- | --- |",
    "| Хоз-бытовое водопотребление | 12,4 м³/сут |",
    "| Расход на пожаротушение | 5,0 л/с |",
    "",
    quote
      ? `## Примечания\n\n- ${quote}`
      : "## Примечания\n\n- Прокладку трубопроводов вести по проекту.",
    "",
  ].join("\n");
}

function genericMarkdown(title: string, page: number): string {
  return [
    `# ${title} — лист ${page}`,
    "",
    "Экспликация помещений и ведомость отделки приведены на листе.",
    "",
    "| Помещение | Площадь, м² |",
    "| --- | --- |",
    "| КПП | 42,5 |",
    "| Помещение охраны | 12,0 |",
    "",
  ].join("\n");
}

// ------------------------------------------------------------------ основное

const existing = (await storage.listProjects()).find(
  (item) => item.name === PROJECT_NAME,
);
if (existing) {
  await storage.deleteProject(existing.id);
  console.log("прежний демо-проект удалён");
}

const project = await storage.createProject(
  PROJECT_NAME,
  "Демо для показа таблицы замечаний: замечания заведены вручную и через ручку приёма.",
);
console.log(`проект: ${project.name} [${project.id}]`);

type Uploaded = { id: string; name: string; pageCount: number };

async function upload(name: string, buffer: Buffer): Promise<Uploaded> {
  const doc = await storage.saveDocument({
    projectId: project.id,
    originalName: name,
    buffer,
  });
  return { id: doc.id, name, pageCount: doc.pageCount };
}

const ios2 = await upload(
  "Раздел ПД №5 Подраздел №2 (ИОС2).pdf",
  await mergeIos2(),
);
const ar5 = await upload(
  "07_Раздел ПД №3 Часть 5 (АР5)_КПП, МР, НСП.pdf",
  await sample("komplekt-demo-ru.pdf"),
);
const pzu = await upload(
  "02_Раздел ПД №2 (ПЗУ).pdf",
  await sample("plany-fasady-karkas.pdf"),
);
const odi = await upload(
  "Раздел ПД №11 (ОДИ).pdf",
  await sample("stroitelnyy-chertezh.pdf"),
);

/** Расшифровка: ИОС2 и ОДИ готовы целиком, АР5 и ПЗУ — наполовину. */
async function recognize(doc: Uploaded, upto: number, body: (page: number) => string) {
  const last = Math.min(upto, doc.pageCount);
  for (let page = 1; page <= last; page += 1) {
    await storage.ingestPage({
      documentId: doc.id,
      pageNumber: page,
      markdown: body(page),
      kind: page % 3 === 0 ? "drawing" : "text",
      source: "model",
    });
  }
  const done = last >= doc.pageCount;
  await storage.updateDocument(doc.id, {
    status: done ? "done" : "processing",
    processingStep: done ? "done" : "text",
    processingPage: done ? null : last + 1,
    errorMessage: null,
  });
  console.log(`  ${doc.name}: ${last}/${doc.pageCount}`);
}

console.log("расшифровка:");
await recognize(ios2, ios2.pageCount, ios2Markdown);
await recognize(odi, odi.pageCount, (page) =>
  genericMarkdown("Раздел ПД №11 (ОДИ)", page),
);
await recognize(ar5, Math.ceil(ar5.pageCount / 2), (page) =>
  genericMarkdown("Раздел ПД №3 Часть 5 (АР5)", page),
);
await recognize(pzu, Math.ceil(pzu.pageCount / 2), (page) =>
  genericMarkdown("Раздел ПД №2 (ПЗУ)", page),
);

// ------------------------------------------------------------------ замечания

/** Номер листа держим внутри документа, иначе переход к листу не откроется. */
function loc(doc: Uploaded, page: number, quote: string) {
  return {
    documentId: doc.id,
    documentName: doc.name,
    pageNumber: Math.min(Math.max(page, 1), doc.pageCount),
    quote,
  };
}

// Инженер заводит замечание словами, без ссылки на лист, — так и бывает.
const manual = [
  await reviews.createReview(project.id, {
    section: "ИОС2",
    text: "Диаметр стояка К1 не сходится с аксонометрией",
    severity: "high",
    origin: "engineer",
    authorName: "Темников Алексей",
  }),
  await reviews.createReview(project.id, {
    section: "АР5",
    text: "Площадь КПП в экспликации и на плане не совпадает",
    severity: "high",
    origin: "engineer",
    authorName: "Темников Алексей",
  }),
  await reviews.createReview(project.id, {
    section: "ИОС2",
    text: "Владимир Михайлович: уточнить, кто монтирует узел учёта — заказчик или подрядчик",
    severity: "medium",
    origin: "engineer",
    authorName: "Темников Алексей",
  }),
];
console.log(`руками заведено: ${manual.length}`);

// Пачка от конвейера. Первые два пункта повторяют формулировки инженера —
// PTO их склеит и покажет строку как «Клиент + ИИ».
const ingest = await reviews.ingestReviews(project.id, [
  {
    section: "ИОС2",
    aiFinding:
      "Диаметр стояка К1 на плане Ø100, на аксонометрии Ø150 — не сходится.",
    severity: "high",
    locations: [
      loc(ios2, 9, IOS2_QUOTES[9]),
      loc(ios2, 14, IOS2_QUOTES[14]),
    ],
  },
  {
    section: "АР5",
    aiFinding:
      "Площадь КПП в экспликации 42,5 м², на плане 38,2 м² — не совпадает.",
    severity: "high",
    locations: [loc(ar5, 4, "КПП — 42,5 м²"), loc(ar5, 6, "КПП — 38,2 м²")],
  },
  {
    section: "ИОС2",
    aiFinding:
      "Расход на внутреннее пожаротушение: в расчёте 2 струи по 2,5 л/с, в спецификации насосная установка на одну струю.",
    severity: "high",
    locations: [
      loc(ios2, 7, IOS2_QUOTES[7]),
      loc(ios2, 12, IOS2_QUOTES[12]),
    ],
  },
  {
    section: "ИОС2",
    aiFinding:
      "Уклон самотечного участка К1 указан только в текстовой части, на плане отсутствует.",
    severity: "medium",
    locations: [loc(ios2, 5, IOS2_QUOTES[5])],
  },
  {
    section: "ИОС2",
    aiFinding:
      "Узел ввода водомерного узла показан условно, деталировки нет ни на плане, ни в спецификации.",
    severity: "medium",
    locations: [loc(ios2, 3, IOS2_QUOTES[3])],
  },
  {
    section: "ИОС2",
    aiFinding:
      "Материал труб участка Т3 в спецификации не указан — «по указанию».",
    severity: "low",
    locations: [loc(ios2, 18, IOS2_QUOTES[18])],
  },
  {
    section: "АР5",
    aiFinding:
      "Узел примыкания НСП к существующему покрытию не показан, отметка сопряжения не задана.",
    severity: "medium",
    locations: [loc(ar5, 11, "Примыкание НСП — узел не показан")],
  },
  {
    section: "АР5",
    aiFinding:
      "В примечании к листу ссылка на ГОСТ 21.501-2011 вместо действующей редакции 2018.",
    severity: "skip",
    locations: [loc(ar5, 2, "ГОСТ 21.501-2011")],
  },
  {
    section: "ПЗУ",
    aiFinding:
      "Радиусы поворота для пожарной техники не подтверждены схемой проезда.",
    severity: "medium",
    locations: [loc(pzu, 3, "Проезд пожарной техники — 4,2 м")],
  },
  {
    section: "ОДИ",
    aiFinding:
      "Уклон пандуса основного пути МГН 8% при нормативных 5% — не проходит по СП 59.13330.",
    severity: "high",
    locations: [loc(odi, 4, "Уклон пандуса 8%")],
  },
  {
    section: "ОДИ",
    aiFinding:
      "Тактильные указатели показаны не на всех входах: у входа в осях 7–8 отсутствуют.",
    severity: "low",
    locations: [loc(odi, 7, "Входная группа в осях 7–8")],
  },
  {
    section: "межраздел",
    aiFinding:
      "Отметка чистого пола 0.000 в АР5 и ИОС2 привязана к разным абсолютным отметкам: 138,60 и 138,45.",
    severity: "high",
    locations: [
      loc(ar5, 2, "0.000 = 138,60"),
      loc(ios2, 1, "0.000 = 138,45"),
    ],
  },
]);
console.log(
  `конвейер: добавлено ${ingest.added}, склеено с ручными ${ingest.enriched}, всего ${ingest.total}`,
);

// Часть уже разобрана с заказчиком — этап «Замечания» показывает прогресс.
const all = await reviews.listReviews(project.id);
const byFinding = (needle: string) =>
  all.find((item) => item.aiFinding.includes(needle) || item.text.includes(needle));

const verdicts: [string, "confirmed" | "partial" | "discuss" | "outdated", string][] = [
  ["внутреннее пожаротушение", "confirmed", "Проектировщик согласен, насос меняем на 2 струи."],
  ["Площадь КПП", "partial", "Площадь уточнят по обмерам, экспликацию поправят."],
  ["Уклон пандуса", "confirmed", "Пандус переделывают на 5%."],
  ["узел учёта", "discuss", "Вернуться к вопросу на следующей встрече."],
  ["ГОСТ 21.501-2011", "outdated", "Редакция ГОСТ — не наше замечание, снимаем."],
];

let marked = 0;
for (const [needle, verdict, comment] of verdicts) {
  const target = byFinding(needle);
  if (!target) continue;
  await reviews.updateReview(project.id, target.id, { verdict, comment });
  marked += 1;
}

const final = await reviews.listReviews(project.id);
const streams = final.reduce<Record<string, number>>((acc, item) => {
  acc[item.origin] = (acc[item.origin] ?? 0) + 1;
  return acc;
}, {});

console.log(`разобрано с заказчиком: ${marked} из ${final.length}`);
console.log(
  `потоки: ИИ ${streams.ai ?? 0}, инженер ${streams.engineer ?? 0}, клиент+ИИ ${streams.both ?? 0}`,
);
console.log("\nготово. npm run dev → войти → проект «Жуковский 1 — демо (ПТО)»");
