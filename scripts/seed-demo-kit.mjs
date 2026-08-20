/**
 * Демо-комплект на базе samples/*.pdf + русские листы (таблица, текст).
 * npx tsx scripts/seed-demo-kit.mjs
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const samples = join(root, "samples");
const outFile = join(samples, "komplekt-demo-ru.pdf");
const oldDemo = join(samples, "demo-komplekt-pto.pdf");
const base = process.env.PTO_BASE_URL || "http://127.0.0.1:8080";
const fontPath = "C:/Windows/Fonts/arial.ttf";
const fontBoldPath = "C:/Windows/Fonts/arialbd.ttf";

async function buildPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(fontPath));
  const fontBold = await doc.embedFont(
    readFileSync(existsSync(fontBoldPath) ? fontBoldPath : fontPath),
  );

  // Чертежи из реальных samples
  const srcA = await PDFDocument.load(
    readFileSync(join(samples, "stroitelnyy-chertezh.pdf")),
  );
  const srcB = await PDFDocument.load(
    readFileSync(join(samples, "plany-fasady-karkas.pdf")),
  );
  const drawn = await doc.copyPages(srcA, [0, 1]); // листы 1–2: планы
  for (const p of drawn) doc.addPage(p);
  const facade = await doc.copyPages(srcB, [0]); // фасады/планы
  doc.addPage(facade[0]);

  // Лист — ведомость (таблица), по-русски
  {
    const page = doc.addPage([842, 595]);
    const { height } = page.getSize();
    let y = height - 40;
    const line = (text, size = 10, bold = false) => {
      page.drawText(text, {
        x: 36,
        y,
        size,
        font: bold ? fontBold : font,
        color: rgb(0.08, 0.09, 0.12),
      });
      y -= size + 5;
    };
    line("ВЕДОМОСТЬ ЭЛЕМЕНТОВ И ОБОРУДОВАНИЯ", 13, true);
    line("Объект: жилой дом. Стадия П. Лист спецификации.", 10);
    line(
      "Поз. | Обозначение | Наименование              | Тип/марка     | Кол. | Масса, кг | Примечание",
      9,
    );
    line(
      "----|-------------|---------------------------|---------------|------|-----------|------------------",
      9,
    );
    const rows = [
      "1   | КМ-1        | Колонна металлическая     | 200x200x8     | 8    | 86,0      | По оси А",
      "2   | БМ-2        | Балка перекрытия          | 30Б1          | 12   | 42,5      | Между осями 1-4",
      "3   | ПСВ-101     | Клапан предохранительный  | Ду50 Ру40     | 2    | 12,5      | Уставка 1,6 МПа",
      "4   | ПСВ-102     | Клапан предохранительный  | Ду80 Ру40     | 1    | 18,0      | Уставка 1,6 МПа",
      "5   | ЗКЛ-210     | Задвижка клиновая         | Ду100 Ру25    | 4    | 42,0      | Фланцевая",
      "6   | КШ-311      | Кран шаровой              | Ду50 Ру16     | 6    | 8,2       | Ручной привод",
      "7   | ОК-405     | Клапан обратный           | Ду80 Ру16     | 3    | 15,4      | Поворотный",
      "8   | ДИ-501      | Датчик расхода            | Ду50          | 2    | 6,1       | 4-20 мА",
      "9   | ДД-502      | Датчик давления           | М20х1,5       | 2    | 3,8       | HART",
      "10  | ТО-601      | Теплообменник             | кожухотрубный | 1    | 210,0     | Q=120 кВт",
      "11  | Н-701       | Насос центробежный        | Ду80          | 2    | 95,0      | С резервом",
      "12  | Рез-801     | Ёмкость накопительная     | V=12 м3       | 1    | 450,0     | Наружная установка",
    ];
    for (const r of rows) line(r, 9);
    line(
      "----|-------------|---------------------------|---------------|------|-----------|------------------",
      9,
    );
    line("Итого позиций: 12 | Суммарная масса: 979,5 кг", 10, true);
  }

  // Лист — пояснительная записка (текст), без слов ПЛАН/ФАСАД/РАЗРЕЗ/УЗЕЛ/ЧЕРТЕЖ
  {
    const page = doc.addPage([595, 842]);
    const { height, width } = page.getSize();
    let y = height - 56;
    const maxW = width - 96;
    const wrap = (text, size, bold = false) => {
      const use = bold ? fontBold : font;
      const words = text.split(/\s+/);
      let cur = "";
      for (const w of words) {
        const trial = cur ? `${cur} ${w}` : w;
        if (use.widthOfTextAtSize(trial, size) > maxW) {
          page.drawText(cur, {
            x: 48,
            y,
            size,
            font: use,
            color: rgb(0.08, 0.09, 0.12),
          });
          y -= size + 5;
          cur = w;
        } else cur = trial;
      }
      if (cur) {
        page.drawText(cur, {
          x: 48,
          y,
          size,
          font: use,
          color: rgb(0.08, 0.09, 0.12),
        });
        y -= size + 5;
      }
      y -= 8;
    };

    wrap("Пояснительная записка к комплекту рабочей документации", 13, true);
    wrap("Стадия П. Демонстрационный комплект для проверки интерфейса PTO.", 10);
    wrap(
      "В составе комплекта приведены графические листы из типовых образцов (этажи и каркас), ведомость элементов с позициями оборудования и настоящая записка со связным описанием порядка проверки.",
      10,
    );
    wrap(
      "Инженер открывает проект, выбирает файл комплекта и проходит листы фильтрами: все страницы, только графика, только таблицы, только текстовые листы. Отметки «просмотрен» сохраняются локально; правки Markdown пишутся в журнал объекта.",
      10,
    );
    wrap(
      "Критерии приёмки демонстрации: во вкладке с графикой видны скопированные листы образцов; во вкладке «Таблицы» — ведомость с обозначениями ПСВ-101 и массой 210 кг; во вкладке «Текст» — эта записка. Поиск по комплекту находит позиции ведомости.",
      10,
    );
    wrap(
      "Порядок работы: просмотреть графику, сверить позиции ведомости с экспликацией, при необходимости исправить извлечённый текст, скачать Markdown. После проверки комплект можно использовать как эталон для обучения коллег.",
      10,
    );
    wrap(
      "Объём записки намеренно увеличен, чтобы классификатор отнёс лист к текстовому типу, а не к коротким выноскам графики. Повторная обработка файла после загрузки должна сохранить типы листов без ручной правки.",
      10,
    );
  }

  const bytes = await doc.save();
  writeFileSync(outFile, bytes);
  console.log("Wrote", outFile, bytes.length, "bytes");
  return outFile;
}

async function api(path, init) {
  const res = await fetch(`${base}${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${path} ${res.status}`);
  return body;
}

async function cleanupOldDemos() {
  const { projects } = await api("/api/projects");
  for (const p of projects) {
    const { documents } = await api(
      `/api/documents?projectId=${encodeURIComponent(p.id)}`,
    );
    for (const d of documents) {
      if (/demo-komplekt|komplekt-demo-ru/i.test(d.originalName)) {
        await fetch(`${base}/api/documents/${d.id}`, { method: "DELETE" });
        console.log("Deleted doc", d.originalName, d.id);
      }
    }
  }
  // удалить пустой проект «Демо для коллег»
  const demo = projects.find((p) => /демо|demo|коллег/i.test(p.name));
  if (demo) {
    const { documents } = await api(
      `/api/documents?projectId=${encodeURIComponent(demo.id)}`,
    );
    for (const d of documents) {
      await fetch(`${base}/api/documents/${d.id}`, { method: "DELETE" });
    }
    // проекта DELETE нет — почистим data/db.json ниже при необходимости
    console.log("Cleared docs in project", demo.id, demo.name);
  }
  if (existsSync(oldDemo)) {
    unlinkSync(oldDemo);
    console.log("Removed", oldDemo);
  }
}

async function targetProjectId() {
  const { projects } = await api("/api/projects");
  const main =
    projects.find((p) => !/демо|demo|коллег/i.test(p.name)) || projects[0];
  if (!main) {
    const created = await api("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Объект демо",
        description: "Комплект для показа коллегам",
      }),
    });
    return created.project.id;
  }
  return main.id;
}

async function upload(projectId, filePath) {
  const buf = readFileSync(filePath);
  const form = new FormData();
  form.append("projectId", projectId);
  form.append(
    "file",
    new Blob([buf], { type: "application/pdf" }),
    "komplekt-demo-ru.pdf",
  );
  return api("/api/documents", { method: "POST", body: form });
}

async function waitDone(projectId, docId) {
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const { documents } = await api(
      `/api/documents?projectId=${encodeURIComponent(projectId)}`,
    );
    const doc = documents.find((d) => d.id === docId);
    if (!doc) continue;
    if (doc.status === "done") return doc;
    if (doc.status === "error")
      throw new Error(doc.errorMessage || "processing error");
    console.log(`… ${doc.status} ${doc.pages?.length || 0}/${doc.pageCount}`);
  }
  throw new Error("timeout");
}

await cleanupOldDemos();
const pdfPath = await buildPdf();

// локальная проверка классификации до загрузки
const { extractPageTexts, pageToMarkdown } = await import("../src/lib/extract.ts");
const texts = await extractPageTexts(readFileSync(pdfPath));
const kinds = texts.map((t, i) => pageToMarkdown(i + 1, "x.pdf", t).kind);
console.log("Local kinds:", kinds.join(", "));

const projectId = await targetProjectId();
const { document } = await upload(projectId, pdfPath);
console.log("Uploaded", document.id);
const done = await waitDone(projectId, document.id);
console.log(
  "Ready:",
  done.pages.map((p) => `${p.pageNumber}:${p.kind}`).join(", "),
);
console.log("Project", projectId);
