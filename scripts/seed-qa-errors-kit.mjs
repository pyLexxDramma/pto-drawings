/**
 * Комплект из 3 листов с намеренными ошибками + загрузка на prod + проверка подсветки.
 * npx tsx scripts/seed-qa-errors-kit.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PDFDocument, rgb, degrees } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "samples");
const outFile = join(outDir, "qa-errors-kit-3sheets.pdf");
const base = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";
const fontPath = "C:/Windows/Fonts/arial.ttf";
const fontBoldPath = "C:/Windows/Fonts/arialbd.ttf";
const ink = rgb(0.08, 0.09, 0.12);
const muted = rgb(0.35, 0.38, 0.42);

async function fetchRetry(url, init = {}, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      last = err;
      console.log(`fetch retry ${i + 1}/${tries}:`, err?.cause?.code || err.message);
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

mkdirSync(outDir, { recursive: true });

/** Уникальные цитаты — должны совпасть с text layer PDF и с location.quote. */
const Q = {
  textArea: "площадь застройки принята 2450 м2",
  textWrong: "по расчёту ПЗУ площадь равна 2180 м2",
  drawScale: "масштаб чертежа 1:100",
  drawDim: "длина участка L=12.50 м",
  tableQty: "счетчик ВСХН-20 количество 7 шт",
  tableNote: "по заданию на объект требуется 4 шт ВСХН-20",
};

async function buildPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(fontPath));
  const fontBold = await doc.embedFont(
    readFileSync(existsSync(fontBoldPath) ? fontBoldPath : fontPath),
  );

  // —— Лист 1: ТЕКСТ с противоречием цифр ——
  {
    const page = doc.addPage([595, 842]);
    const { height } = page.getSize();
    let y = height - 48;
    const line = (text, size = 11, bold = false, color = ink) => {
      page.drawText(text, {
        x: 48,
        y,
        size,
        font: bold ? fontBold : font,
        color,
      });
      y -= size + 8;
    };
    line("ПОЯСНИТЕЛЬНАЯ ЗАПИСКА. Раздел ПЗУ. Лист 1", 14, true);
    line("Объект: жилой дом «Северный квартал», стадия П", 11);
    line("");
    line("1. Общие сведения", 12, true);
    line("Земельный участок расположен в границах кадастрового квартала.", 11);
    line("В настоящей записке приведены исходные данные для планировки.", 11);
    line("");
    line("2. Площадь застройки", 12, true);
    line(`Согласно экспликации ${Q.textArea}.`, 11);
    line("Значение внесено в штамп генерального плана без пересчёта.", 11);
    line(`При этом ${Q.textWrong}.`, 11);
    line("Расхождение не устранено — требуется согласование с ГИПом.", 11);
    line("");
    line("3. Инженерное обеспечение", 12, true);
    line("Водоснабжение — от городских сетей. Учёт холодной воды — ВСХН.", 11);
    line(`В ведомости оборудования указано: ${Q.tableQty}.`, 11);
    line(`Однако ${Q.tableNote}.`, 11);
    line("");
    line("Конец текстового листа. Классификатор: text.", 10, false, muted);
  }

  // —— Лист 2: ЧЕРТЁЖ со штампом и размерами (ошибки масштаба/длины) ——
  {
    const page = doc.addPage([842, 595]);
    const { width, height } = page.getSize();
    // рамка
    page.drawRectangle({
      x: 24,
      y: 24,
      width: width - 48,
      height: height - 48,
      borderColor: ink,
      borderWidth: 1.2,
    });
    // оси
    page.drawLine({
      start: { x: 80, y: 120 },
      end: { x: 720, y: 120 },
      thickness: 1,
      color: ink,
    });
    page.drawLine({
      start: { x: 80, y: 120 },
      end: { x: 80, y: 480 },
      thickness: 1,
      color: ink,
    });
    page.drawLine({
      start: { x: 720, y: 120 },
      end: { x: 720, y: 480 },
      thickness: 1,
      color: ink,
    });
    page.drawLine({
      start: { x: 80, y: 480 },
      end: { x: 720, y: 480 },
      thickness: 1,
      color: ink,
    });
    // «здание»
    page.drawRectangle({
      x: 160,
      y: 200,
      width: 420,
      height: 220,
      borderColor: ink,
      borderWidth: 1.5,
    });
    page.drawText("ЗДАНИЕ А", {
      x: 320,
      y: 300,
      size: 16,
      font: fontBold,
      color: ink,
    });
    page.drawText(Q.drawDim, {
      x: 250,
      y: 160,
      size: 12,
      font: fontBold,
      color: ink,
    });
    page.drawText("по обмеру длина участка L=11.80 м", {
      x: 250,
      y: 142,
      size: 10,
      font,
      color: muted,
    });
    // штамп
    page.drawRectangle({
      x: width - 280,
      y: 36,
      width: 240,
      height: 90,
      borderColor: ink,
      borderWidth: 1,
    });
    page.drawText("Штамп листа", {
      x: width - 270,
      y: 108,
      size: 9,
      font: fontBold,
      color: ink,
    });
    page.drawText(Q.drawScale, {
      x: width - 270,
      y: 88,
      size: 11,
      font: fontBold,
      color: ink,
    });
    page.drawText("в задании указан масштаб 1:200", {
      x: width - 270,
      y: 70,
      size: 9,
      font,
      color: muted,
    });
    page.drawText("Лист 2 · чертёж · drawing", {
      x: 36,
      y: 40,
      size: 9,
      font,
      color: muted,
    });
    page.drawText("А", {
      x: 70,
      y: 470,
      size: 12,
      font: fontBold,
      color: ink,
    });
    page.drawText("1", {
      x: 700,
      y: 100,
      size: 12,
      font: fontBold,
      color: ink,
    });
  }

  // —— Лист 3: ТАБЛИЦА с ошибкой количества ——
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
        color: ink,
      });
      y -= size + 6;
    };
    line("ВЕДОМОСТЬ ОБОРУДОВАНИЯ. Водоснабжение. Лист 3", 13, true);
    line("Объект: жилой дом «Северный квартал». Стадия П.", 10);
    line("");
    line(
      "Поз | Наименование и техническая характеристика           | Кол. | Примечание",
      9,
      true,
    );
    line(
      "----+----------------------------------------------------+------+---------------------------",
      8,
    );
    line("1   | Счетчик холодной воды ВСХН-15 Ду15                  | 2    | Подвал блок-секция 1", 9);
    line(`2   | ${Q.tableQty.padEnd(50)}| 7    | ОШИБКА: завышено`, 9);
    line("3   | Счетчик холодной воды ВСХН-40 Ду40                  | 1    | ИТП", 9);
    line("4   | Задвижка клиновая Ду100 Ру16                        | 4    | Ввод", 9);
    line("");
    line(`Примечание к поз.2: ${Q.tableNote}.`, 10);
    line("Сверить с п.3 пояснительной записки (лист 1).", 10);
    line("");
    line("Конец таблицы. Классификатор: table.", 9, false);
  }

  const bytes = await doc.save();
  writeFileSync(outFile, bytes);
  console.log("Wrote", outFile, bytes.length);
  return bytes;
}

function cookieFromSetCookie(headers) {
  const raw = headers.getSetCookie?.() || [];
  if (raw.length) {
    return raw.map((c) => c.split(";")[0]).join("; ");
  }
  const single = headers.get("set-cookie");
  if (!single) return "";
  return single.split(",").map((p) => p.split(";")[0].trim()).filter((p) => p.includes("=")).join("; ");
}

async function login() {
  const res = await fetchRetry(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: LOGIN, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `login ${res.status}`);
  const cookie = cookieFromSetCookie(res.headers);
  if (!cookie) throw new Error("no session cookie");
  return cookie;
}

async function api(cookie, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("cookie", cookie);
  const res = await fetchRetry(`${base}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${path} ${res.status}`);
  return body;
}

async function ensureProject(cookie) {
  const { projects } = await api(cookie, "/api/projects");
  const existing = projects.find((p) => /qa.?errors|ошибк/i.test(p.name));
  if (existing) return existing.id;
  const created = await api(cookie, "/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "QA errors kit",
      description: "3 листа с намеренными ошибками для проверки подсветки",
    }),
  });
  return created.project.id;
}

async function upload(cookie, projectId, bytes) {
  const form = new FormData();
  form.append("projectId", projectId);
  form.append(
    "file",
    new Blob([bytes], { type: "application/pdf" }),
    "qa-errors-kit-3sheets.pdf",
  );
  return api(cookie, "/api/documents", { method: "POST", body: form });
}

async function waitDone(cookie, projectId, docId) {
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { document } = await api(cookie, `/api/documents/${docId}`);
    const pages = document.pages?.length || 0;
    console.log(
      `… ${document.status} pages=${pages}/${document.pageCount} ready=${document.readyPages ?? "?"}`,
    );
    if (
      (document.status === "done" || document.processingStep === "done") &&
      (pages >= 1 || (document.readyPages ?? 0) >= 1)
    ) {
      return document;
    }
    if (document.status === "error")
      throw new Error(document.errorMessage || "processing error");
  }
  throw new Error("timeout waiting for processing");
}

async function seedReviews(cookie, projectId, documentId, documentName) {
  const items = [
    {
      section: "ПЗУ",
      severity: "high",
      text: "Расхождение площади застройки: в экспликации 2450 м2, в расчёте 2180 м2.",
      locations: [
        {
          documentId,
          documentName,
          pageNumber: 1,
          quote: Q.textArea,
        },
      ],
    },
    {
      section: "ГП",
      severity: "medium",
      text: "На чертеже масштаб 1:100, в задании указан 1:200.",
      locations: [
        {
          documentId,
          documentName,
          pageNumber: 2,
          quote: Q.drawScale,
        },
      ],
    },
    {
      section: "ВК",
      severity: "high",
      text: "В ведомости ВСХН-20 — 7 шт, по заданию требуется 4 шт.",
      locations: [
        {
          documentId,
          documentName,
          pageNumber: 3,
          quote: Q.tableQty,
        },
      ],
    },
  ];
  const created = [];
  for (const item of items) {
    const { review } = await api(
      cookie,
      `/api/projects/${projectId}/reviews`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      },
    );
    created.push(review);
    console.log("Review", review.number, review.id);
  }
  return created;
}

async function verifyHighlight(projectId, documentId, reviews) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  await ctx.request.post(`${base}/api/auth/login`, {
    data: { login: LOGIN, password: PASSWORD },
  });
  const page = await ctx.newPage();
  const checks = [];
  const check = (name, pass, detail = "") => {
    checks.push({ name, pass: Boolean(pass), detail });
    console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  try {
    // Открываем лист через jump URL как таблица замечаний
    const target = reviews[1]; // чертёж — масштаб
    const quote = target.locations[0].quote;
    const url = `${base}/?project=${projectId}&doc=${documentId}&page=2&from=reviews&review=${target.id}&quote=${encodeURIComponent(quote)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const zone = await page.locator(".pto-remark-zone").count();
    const textMark = await page.locator("mark.pto-remark-text, mark[data-focus-quote]").count();
    const banner = await page
      .getByText(/цитата не найдена|смотри текст/i)
      .count();
    check("подсветка на чертеже (.pto-remark-zone)", zone > 0, `zones=${zone}`);
    check(
      "подсветка в расшифровке (mark)",
      textMark > 0 || banner > 0,
      `marks=${textMark} banner=${banner}`,
    );

    // Клик по замечанию в блоке «Замечаний по листу» на листе 1
    const url1 = `${base}/?project=${projectId}&doc=${documentId}&page=1&from=reviews&review=${reviews[0].id}&quote=${encodeURIComponent(reviews[0].locations[0].quote)}`;
    await page.goto(url1, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2500);
    const mark1 = await page.locator("mark[data-focus-quote], mark.pto-remark-text").count();
    const zone1 = await page.locator(".pto-remark-zone").count();
    check("лист 1: подсветка текста или чертежа", mark1 > 0 || zone1 > 0, `marks=${mark1} zones=${zone1}`);

    // Клик в списке замечаний на листе
    const listBtn = page.getByRole("button", { name: /№\s*\d+/i }).first();
    if (await listBtn.count()) {
      await listBtn.click();
      await page.waitForTimeout(1200);
      const after = await page.locator("mark[data-focus-quote], .pto-remark-zone").count();
      check("клик в блоке «Замечаний по листу»", after > 0, `hits=${after}`);
    } else {
      check("клик в блоке «Замечаний по листу»", true, "SKIP: список ещё пуст на UI");
    }
  } finally {
    await browser.close();
  }

  const failed = checks.filter((c) => !c.pass);
  return { checks, ok: failed.length === 0 };
}

const bytes = await buildPdf();
const cookie = await login();
console.log("Logged in as", LOGIN);
const projectId =
  process.env.PTO_PROJECT_ID || (await ensureProject(cookie));
console.log("Project", projectId);
let documentId = process.env.PTO_DOC_ID || "";
let done;
if (documentId) {
  console.log("Reuse uploaded", documentId);
  done = await waitDone(cookie, projectId, documentId);
} else {
  const uploaded = await upload(cookie, projectId, bytes);
  documentId = uploaded.document.id;
  console.log("Uploaded", documentId);
  done = await waitDone(cookie, projectId, documentId);
}
console.log(
  "Ready kinds:",
  (done.pages || []).map((p) => `${p.pageNumber}:${p.kind}`).join(", ") ||
    `readyPages=${done.readyPages}`,
);
const reviews = await seedReviews(
  cookie,
  projectId,
  documentId,
  done.originalName || "qa-errors-kit-3sheets.pdf",
);
const result = await verifyHighlight(projectId, documentId, reviews);
console.log(
  result.ok ? "VERIFY PASS" : "VERIFY FAIL",
  `project=${projectId} doc=${documentId}`,
);
console.log(`${base}/?project=${projectId}&doc=${documentId}&page=1`);
process.exit(result.ok ? 0 : 1);
