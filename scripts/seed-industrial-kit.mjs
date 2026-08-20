/**
 * Крупный промышленный комплект: РЕАЛЬНЫЕ листы из samples + русские ведомости/записки.
 * npx tsx scripts/seed-industrial-kit.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const samples = join(root, "samples");
const outFile = join(samples, "zavod-kompleks-demo-ru.pdf");
const base = process.env.PTO_BASE_URL || "http://127.0.0.1:8080";
const fontPath = "C:/Windows/Fonts/arial.ttf";
const fontBoldPath = "C:/Windows/Fonts/arialbd.ttf";
const ink = rgb(0.08, 0.09, 0.12);

async function buildPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(fontPath));
  const fontBold = await doc.embedFont(
    readFileSync(existsSync(fontBoldPath) ? fontBoldPath : fontPath),
  );

  // Плотные чертежи из реальных samples (не пустые схемы)
  const srcA = await PDFDocument.load(
    readFileSync(join(samples, "stroitelnyy-chertezh.pdf")),
  );
  const srcB = await PDFDocument.load(
    readFileSync(join(samples, "plany-fasady-karkas.pdf")),
  );
  // все 6 листов строительного комплекта
  for (const p of await doc.copyPages(
    srcA,
    Array.from({ length: srcA.getPageCount() }, (_, i) => i),
  )) {
    doc.addPage(p);
  }
  // все листы планов/фасадов/каркаса
  for (const p of await doc.copyPages(
    srcB,
    Array.from({ length: srcB.getPageCount() }, (_, i) => i),
  )) {
    doc.addPage(p);
  }

  const drawTablePage = (title, subtitle, header, rows, footer) => {
    const page = doc.addPage([842, 595]);
    const { height } = page.getSize();
    let y = height - 36;
    const line = (text, size = 8, bold = false) => {
      page.drawText(text, {
        x: 28,
        y,
        size,
        font: bold ? fontBold : font,
        color: ink,
      });
      y -= size + 3;
    };
    line(title, 11, true);
    line(subtitle, 8);
    line(header, 7);
    line("-".repeat(118), 7);
    for (const r of rows) line(r, 7);
    line("-".repeat(118), 7);
    line(footer, 8, true);
  };

  // Ведомость 1 — оборудование (много строк)
  drawTablePage(
    "ВЕДОМОСТЬ ТЕХНОЛОГИЧЕСКОГО ОБОРУДОВАНИЯ — НПЗ «Северный», АВТ-6",
    "Объект промышленный. Стадия П. Лист ВМ-ТХ-01. Данные для вкладки «Таблицы».",
    "Поз | Обозн.   | Наименование                     | Тип/параметр      | Кол | Масса кг | Цех/зона",
    Array.from({ length: 36 }, (_, i) => {
      const n = i + 1;
      const kinds = [
        ["П", "Печь трубчатая", "120 Гкал/ч"],
        ["К", "Колонна ректификационная", "⌀4,2 м"],
        ["Е", "Ёмкость горизонтальная", "V=40 м3"],
        ["Т", "Теплообменник кожухотрубный", "F=180 м2"],
        ["Н", "Насос центробежный", "Q=120 м3/ч"],
        ["АВО", "Аппарат возд. охлаждения", "N=6 вент."],
        ["Р", "Реактор", "V=25 м3"],
        ["Ф", "Фильтр сетчатый", "Ду200"],
        ["ПСВ", "Клапан предохранительный", "Ду80 Ру40"],
        ["КР", "Клапан регулирующий", "Ду100"],
        ["ДИ", "Датчик расхода", "4-20 мА"],
        ["ДД", "Датчик давления", "HART"],
      ];
      const k = kinds[i % kinds.length];
      const tag = `${k[0]}-${100 + n}`;
      return `${String(n).padStart(2)}  | ${tag.padEnd(8)} | ${k[1].padEnd(32)} | ${k[2].padEnd(16)} | ${1 + (i % 3)}   | ${(8 + n * 4.3).toFixed(1).padStart(7)} | АВТ-${1 + (i % 3)}`;
    }),
    "Итого позиций: 36. Массы по паспортам заводов-изготовителей.",
  );

  // Ведомость 2 — трубопроводы
  drawTablePage(
    "ВЕДОМОСТЬ ТРУБОПРОВОДОВ И АРМАТУРЫ — ЭСТАКАДА Е-1 / МЕЖЦЕХОВЫЕ СВЯЗИ",
    "Объект промышленный. Стадия П. Лист ВМ-ТХ-02.",
    "Поз | Линия   | Среда        | Ду  | Ру  | Длина м | Материал         | Примечание",
    Array.from({ length: 40 }, (_, i) => {
      const n = i + 1;
      const media = [
        "сырьё",
        "бензин",
        "керосин",
        "дизель",
        "мазут",
        "ВГО",
        "пар 1,2",
        "конденсат",
        "азот",
        "воздух КИП",
      ];
      return `${String(n).padStart(2)}  | Л-${200 + n} | ${media[i % media.length].padEnd(11)} | ${String(50 + (i % 10) * 25).padStart(3)} | ${[16, 25, 40][i % 3]}  | ${String(30 + i * 8).padStart(6)} | ${i % 2 ? "12Х18Н10Т" : "Ст20".padEnd(9)} | эстакада Е-${1 + (i % 4)}`;
    }),
    "Итого линий: 40. Длины ориентировочные до исполнительных съёмок.",
  );

  // Ведомость 3 — КИПиА / электро
  drawTablePage(
    "ВЕДОМОСТЬ СРЕДСТВ КИП, АВТОМАТИКИ И ЭЛЕКТРООБОРУДОВАНИЯ",
    "Объект промышленный. Стадия П. Лист ВМ-АТХ-03.",
    "Поз | Позиция  | Наименование                     | Сигнал/тип       | Кол | Размещение",
    Array.from({ length: 32 }, (_, i) => {
      const n = i + 1;
      const items = [
        ["FT", "Расходомер ультразвуковой", "4-20 мА+HART"],
        ["PT", "Датчик давления", "4-20 мА"],
        ["TT", "Термопреобразователь", "Pt100"],
        ["LT", "Уровнемер радарный", "4-20 мА"],
        ["XV", "Отсечной клапан", "24В DC"],
        ["HS", "Кнопка аварийного останова", "NO"],
        ["Q", "Газоанализатор", "4-20 мА"],
        ["B", "Извещатель пожарный", "шлейф"],
      ];
      const it = items[i % items.length];
      return `${String(n).padStart(2)}  | ${it[0]}-${300 + n} | ${it[1].padEnd(32)} | ${it[2].padEnd(16)} | ${1 + (i % 2)}   | ${i % 3 === 0 ? "ЦПУ" : i % 3 === 1 ? "поле АВТ" : "эстакада"}`;
    }),
    "Итого позиций КИП/ЭМ: 32. Привязка к шкафам — по заданиям АТХ/ЭМ.",
  );

  const wrapPage = (title, subtitle, paragraphs) => {
    const page = doc.addPage([595, 842]);
    const { height, width } = page.getSize();
    let y = height - 48;
    const maxW = width - 72;
    const put = (text, size, bold = false) => {
      const use = bold ? fontBold : font;
      const words = text.split(/\s+/);
      let cur = "";
      for (const w of words) {
        const trial = cur ? `${cur} ${w}` : w;
        if (use.widthOfTextAtSize(trial, size) > maxW) {
          page.drawText(cur, { x: 36, y, size, font: use, color: ink });
          y -= size + 4;
          cur = w;
        } else cur = trial;
      }
      if (cur) {
        page.drawText(cur, { x: 36, y, size, font: use, color: ink });
        y -= size + 4;
      }
      y -= 8;
    };
    put(title, 12, true);
    put(subtitle, 9);
    for (const p of paragraphs) put(p, 10);
  };

  wrapPage(
    "Пояснительная записка. Том 1 — состав промышленного комплекса",
    "НПЗ «Северный». Установка АВТ-6 и связанные подсистемы. Стадия П.",
    [
      "Том описывает состав промышленного объекта в части атмосферно-вакуумной перегонки и инфраструктуры площадки. Графическая часть комплекта собрана из плотных листов образцов (этажи, виды, каркас) и дополнена ведомостями позиций.",
      "В границах площадки: основное производство АВТ-6, блок гидроочистки, риформинг, товарный парк резервуаров, железнодорожная и автомобильная эстакады, центральный пункт управления, подстанция 110/6 кВ, факельная система, насосные и сети оборотной воды.",
      "Производительность по сырью — 6,0 млн т/год, фонд времени 8400 ч/год. Категория взрывопожарной опасности основного производства — А. Сырьё поступает по магистрали и с эстакады; товарные фракции направляются в парк и на смежные установки.",
      "Инженер проверяет комплект в PTO: сначала графические листы с насыщенной геометрией и выносками, затем таблицы ведомостей, затем текстовые тома. Поиск по комплекту должен находить обозначения позиций и длины линий.",
      "Система противоаварийной защиты — на ПЛК класса SIL-2. Газоанализ и пожарная сигнализация выводятся в ЦПУ. Электроснабжение — две секции 6 кВ, резерв операторной от ДГУ.",
      "Водоснабжение оборотное ОХВ-1, стоки нефтесодержащие — на локальные очистные. Отходы передаются лицензированному подрядчику. Нормативы выбросов и сбросов — в отдельном разделе ООС.",
      "Связанные документы: ведомости ВМ-ТХ-01, ВМ-ТХ-02, ВМ-АТХ-03; графические листы из строительных и каркасных образцов; задания смежным специальностям.",
      "Объём тома увеличен сознательно, чтобы классификатор отнёс лист к текстовому типу. Повторная обработка после загрузки сохраняет типы листов.",
    ],
  );

  wrapPage(
    "Пояснительная записка. Том 2 — потоки, автоматизация и порядок проверки",
    "НПЗ «Северный». Взаимодействие подсистем. Стадия П.",
    [
      "Том детализирует материальные и энергетические потоки между установкой, парком, эстакадой и энергоблоком без дублирования обозначений графики.",
      "Поток сырья: приёмные резервуары → насосы подачи → подготовка → печи → колонны. Возврат некондиции — в сырьевые ёмкости. Продукты охлаждаются, сепарируются и уходят в товарный парк; вакуумный газойль — на гидроочистку.",
      "Пар 1,2 и 0,4 МПа — от заводской ТЭЦ, конденсат возвращается. Азот — для продувок и инертной подушки. Воздух КИП — от компрессорной с осушкой.",
      "Автоматизация: распределённая система, станции в ЦПУ, резервированная шина, архив параметров. Блокировки печей по погасанию факела, давлению топлива и расходу сырья; отсечка при загазованности.",
      "Очереди строительства: 1 — АВТ-6 и инфраструктура; 2 — гидроочистка и риформинг. Пусконаладка — по согласованной программе ПНР.",
      "Охрана труда: паспорта опасности, инструкции, СИЗ, обучение до допуска. Производственный контроль и экологический мониторинг ведутся по графику.",
      "Порядок работы в интерфейсе: открыть файл завода, пройти вкладки графика / таблицы / текст, отметить просмотренные листы, при необходимости исправить Markdown и скачать выгрузку.",
      "При обновлении паспортных данных массы и типы приводов уточняются без ломки структуры тома. Файл предназначен как насыщенный демонстрационный комплект для коллег.",
      "Дополнительно зафиксированы критерии приёмки: не менее девяти графических листов с реальным содержимым образцов, три ведомости с десятками строк, два текстовых тома связного описания.",
    ],
  );

  const bytes = await doc.save();
  writeFileSync(outFile, bytes);
  console.log("Wrote", outFile, bytes.length, "bytes, pages", doc.getPageCount());
  return outFile;
}

async function api(path, init) {
  const res = await fetch(`${base}${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${path} ${res.status}`);
  return body;
}

async function uploadNamed(projectId, filePath, originalName) {
  const form = new FormData();
  form.append("projectId", projectId);
  form.append(
    "file",
    new Blob([readFileSync(filePath)], { type: "application/pdf" }),
    originalName,
  );
  return api("/api/documents", { method: "POST", body: form });
}

async function waitDone(projectId, docId) {
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const { documents } = await api(
      `/api/documents?projectId=${encodeURIComponent(projectId)}`,
    );
    const doc = documents.find((d) => d.id === docId);
    if (!doc) continue;
    if (doc.status === "done") return doc;
    if (doc.status === "error") throw new Error(doc.errorMessage || "error");
    if (i % 8 === 0)
      console.log(`… ${doc.originalName} ${doc.status} ${doc.pages?.length}/${doc.pageCount}`);
  }
  throw new Error("timeout " + docId);
}

async function buildPreviousKomplekt() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(fontPath));
  const fontBold = await doc.embedFont(
    readFileSync(existsSync(fontBoldPath) ? fontBoldPath : fontPath),
  );
  const srcA = await PDFDocument.load(
    readFileSync(join(samples, "stroitelnyy-chertezh.pdf")),
  );
  const srcB = await PDFDocument.load(
    readFileSync(join(samples, "plany-fasady-karkas.pdf")),
  );
  for (const p of await doc.copyPages(srcA, [0, 1])) doc.addPage(p);
  for (const p of await doc.copyPages(srcB, [0])) doc.addPage(p);

  {
    const page = doc.addPage([842, 595]);
    let y = 555;
    const line = (t, s = 9, b = false) => {
      page.drawText(t, {
        x: 36,
        y,
        size: s,
        font: b ? fontBold : font,
        color: ink,
      });
      y -= s + 5;
    };
    line("ВЕДОМОСТЬ ЭЛЕМЕНТОВ И ОБОРУДОВАНИЯ", 12, true);
    line("Объект: жилой дом. Стадия П.", 9);
    line(
      "Поз. | Обозначение | Наименование              | Тип/марка     | Кол. | Масса, кг | Примечание",
      8,
    );
    line(
      "----|-------------|---------------------------|---------------|------|-----------|------------------",
      8,
    );
    for (const r of [
      "1   | КМ-1        | Колонна металлическая     | 200x200x8     | 8    | 86,0      | По оси А",
      "2   | БМ-2        | Балка перекрытия          | 30Б1          | 12   | 42,5      | Между осями 1-4",
      "3   | ПСВ-101     | Клапан предохранительный  | Ду50 Ру40     | 2    | 12,5      | Уставка 1,6 МПа",
      "4   | ПСВ-102     | Клапан предохранительный  | Ду80 Ру40     | 1    | 18,0      | Уставка 1,6 МПа",
      "5   | ЗКЛ-210     | Задвижка клиновая         | Ду100 Ру25    | 4    | 42,0      | Фланцевая",
      "6   | КШ-311      | Кран шаровой              | Ду50 Ру16     | 6    | 8,2       | Ручной привод",
      "7   | КО-405      | Клапан обратный           | Ду80 Ру16     | 3    | 15,4      | Поворотный",
      "8   | ДИ-501      | Датчик расхода            | Ду50          | 2    | 6,1       | 4-20 мА",
      "9   | ДД-502      | Датчик давления           | М20х1,5       | 2    | 3,8       | HART",
      "10  | ТО-601      | Теплообменник             | кожухотрубный | 1    | 210,0     | Q=120 кВт",
      "11  | Н-701       | Насос центробежный        | Ду80          | 2    | 95,0      | С резервом",
      "12  | Рез-801     | Ёмкость накопительная     | V=12 м3       | 1    | 450,0     | Наружная установка",
    ])
      line(r, 8);
    line(
      "----|-------------|---------------------------|---------------|------|-----------|------------------",
      8,
    );
    line("Итого позиций: 12", 9, true);
  }

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
          page.drawText(cur, { x: 48, y, size, font: use, color: ink });
          y -= size + 5;
          cur = w;
        } else cur = trial;
      }
      if (cur) {
        page.drawText(cur, { x: 48, y, size, font: use, color: ink });
        y -= size + 5;
      }
      y -= 8;
    };
    wrap("Пояснительная записка к комплекту рабочей документации", 12, true);
    wrap("Стадия П. Демонстрационный комплект (базовый).", 9);
    wrap(
      "В составе комплекта приведены графические листы из типовых образцов (этажи и каркас), ведомость элементов и настоящая записка. Инженер проходит фильтры вкладок и отмечает просмотренные листы.",
      10,
    );
    wrap(
      "Критерии: во вкладке с графикой — скопированные листы образцов; в «Таблицы» — ведомость с ПСВ-101 и массой 210 кг; в «Текст» — эта записка.",
      10,
    );
    wrap(
      "Порядок работы: просмотреть графику, сверить позиции ведомости, при необходимости исправить текст, скачать Markdown.",
      10,
    );
    wrap(
      "Объём записки увеличен, чтобы классификатор отнёс лист к текстовому типу, а не к коротким выноскам графики.",
      10,
    );
  }

  const path = join(samples, "komplekt-demo-ru.pdf");
  writeFileSync(path, await doc.save());
  console.log("Restored", path);
  return path;
}

async function run() {
  const industrialPath = await buildPdf();
  const previousPath = await buildPreviousKomplekt();

  const { extractPageTexts, pageToMarkdown } = await import("../src/lib/extract.ts");
  for (const [label, path] of [
    ["industrial", industrialPath],
    ["previous", previousPath],
  ]) {
    const texts = await extractPageTexts(readFileSync(path));
    const kinds = texts.map((t, i) => pageToMarkdown(i + 1, "x.pdf", t).kind);
    console.log(
      label,
      kinds.reduce((a, k) => ((a[k] = (a[k] || 0) + 1), a), {}),
      kinds.map((k, i) => `${i + 1}:${k}`).join(", "),
    );
  }

  const { projects } = await api("/api/projects");
  const project = projects[0];
  if (!project) throw new Error("no project");

  const { documents } = await api(
    `/api/documents?projectId=${encodeURIComponent(project.id)}`,
  );
  for (const d of documents) {
    if (/komplekt-demo-ru|zavod-kompleks-demo/i.test(d.originalName)) {
      await fetch(`${base}/api/documents/${d.id}`, { method: "DELETE" });
      console.log("Deleted", d.originalName);
    }
  }

  for (const [path, name] of [
    [previousPath, "komplekt-demo-ru.pdf"],
    [industrialPath, "zavod-kompleks-demo-ru.pdf"],
  ]) {
    const { document } = await uploadNamed(project.id, path, name);
    console.log("Uploaded", name, document.id);
    const done = await waitDone(project.id, document.id);
    console.log(
      "Ready",
      name,
      done.pages.map((p) => `${p.pageNumber}:${p.kind}`).join(", "),
    );
  }
}

await run();
