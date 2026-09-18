/**
 * Проверка после правок 18.09: подсветка цитаты, плашка «Цитата не найдена»,
 * отсутствие полоски «Лист открыт из разбора», rect и кириллица у мест.
 *   PTO_BASE_URL=https://pto.tw1.su PTO_LOGIN=admin PTO_PASSWORD=... \
 *   node scripts/verify-quote-banner-prod.mjs
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const shots = join(dirname(fileURLToPath(import.meta.url)), "..", "samples", "shots");
const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";
const PROJECT_RE = new RegExp(process.env.PTO_PROJECT || "TestUI|Lexx", "i");
const FILE_RE = new RegExp(process.env.PTO_FILE || "Северный", "i");

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1600, height: 950 },
});

const auth = await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
  timeout: 60000,
});
check("вход", auth.ok(), String(auth.status()));
if (!auth.ok()) {
  await browser.close();
  process.exit(1);
}

const { projects = [] } = await (await ctx.request.get(`${BASE}/api/projects`)).json();
const project = projects.find((item) => PROJECT_RE.test(item.name)) ?? projects[0];
console.log(`проект: ${project?.name} (${project?.id})`);

const { documents = [] } = await (
  await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
).json();
const { reviews = [] } = await (
  await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
).json();

const north = documents.filter((item) => FILE_RE.test(item.originalName));
console.log(
  "файлы:",
  north
    .map((d) => `${d.originalName} стр.${d.pageCount}/готово ${d.readyPages} ${d.createdAt ?? ""}`)
    .join(" | ") || "(нет)",
);
check(`залит файл ${FILE_RE.source}`, north.length > 0, `${north.length} файл(ов)`);

const aiReviews = reviews.filter((item) => item.origin === "ai" || item.origin === "both");
const places = aiReviews.flatMap((item) => item.locations || []);
const withRect = places.filter((item) => item.rect);
check(
  "rect у всех мест ИИ",
  places.length > 0 && withRect.length === places.length,
  `${withRect.length}/${places.length}`,
);

const tallRect = withRect.filter((item) => item.rect.h > 0.05);
check("рамка не выше строки (h ≤ 0.05)", tallRect.length === 0, `высоких: ${tallRect.length}`);

const quotes = places.map((item) => (item.quote || "").trim()).filter(Boolean);
// Обрезанное слово = осколок букв на краю цитаты. Единицы и шифры — нормально.
const UNITS = /^(м|м2|мм|см|шт|кг|т|кВт|кв|%|л|ч|мг|га)$/i;
const brokenWords = quotes.filter((q) => {
  if (q.length <= 12) return false;
  const words = q.split(/\s+/);
  const edges = [words[0], words[words.length - 1]];
  // Заглавные (II, А, ГОСТ) — это значения и шифры, а не осколки слов.
  return edges.some(
    (word) => /^\p{Ll}{1,2}$/u.test(word) && !UNITS.test(word),
  );
});
check("цитаты целыми словами", brokenWords.length === 0, brokenWords.slice(0, 2).join(" / "));
const multiline = quotes.filter((q) => /\n/.test(q));
check("цитата одной строкой", multiline.length === 0, `${multiline.length}`);

const cadDoc = north.find((item) => /\.(dxf|dwg)$/i.test(item.originalName));
if (cadDoc) {
  // В комплекте PDF+DWG места ИИ живут на PDF-члене, у DWG — та же расшифровка.
  const detail = await (await ctx.request.get(`${BASE}/api/documents/${cadDoc.id}`)).json();
  const md = (detail.document?.pages ?? [])[0]?.markdown ?? "";
  const mojibake = /\uFFFD/.test(md) || /Ð[\u0080-\u00BF]/.test(md);
  check(
    "кириллица в расшифровке DXF",
    /[А-Яа-яЁё]{4,}/.test(md) && !mojibake,
    mojibake ? "есть битые символы" : `${md.length} симв.`,
  );
  const cadPlaces = places.filter((item) => item.documentId === cadDoc.id).length;
  console.log(`—   мест на DXF: ${cadPlaces} (в комплекте места ИИ ставятся на PDF)`);
}

const page = await ctx.newPage();
const logs = [];
page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) logs.push(`${msg.type()}: ${msg.text()}`);
});

const pdfDoc = north.find((item) => /\.pdf$/i.test(item.originalName));
const targets = aiReviews
  .flatMap((review) =>
    (review.locations || [])
      .filter((loc) => loc.documentId === pdfDoc?.id && loc.pageNumber && loc.quote)
      .map((loc) => ({ review, loc })),
  )
  .slice(0, 4);
check("есть места на PDF для проверки", targets.length > 0, `${targets.length}`);

let index = 0;
for (const { review, loc } of targets) {
  index += 1;
  const url =
    `${BASE}/?project=${project.id}&doc=${loc.documentId}&page=${loc.pageNumber}` +
    `&from=reviews&review=${review.id}&quote=${encodeURIComponent(loc.quote)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page
    .getByText("Загрузка…")
    .waitFor({ state: "hidden", timeout: 45000 })
    .catch(() => {});
  await page.waitForTimeout(6000);

  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const found = text.match(/найдено:\s*(\d+)/i);
    return {
      foundCount: found ? Number(found[1]) : null,
      quoteMissBanner: /цитата не найдена/i.test(text),
      noLayerBanner: /нет текстового слоя/i.test(text),
      peekStrip: /лист открыт из разбора/i.test(text),
      newTabLink: /файл в новой вкладке/i.test(text),
      zones: document.querySelectorAll(".pto-remark-zone").length,
      marks: document.querySelectorAll("mark").length,
      placeBar: /Место\s+\d+\s+из\s+\d+/i.test(text),
      // Рамка места — зелёная, «другие места» — синие.
      greenRects: document.querySelectorAll("[class*='outline-emerald-600']").length,
      blueRects: document.querySelectorAll("[class*='outline-sky-600']").length,
      // Подписи легенды гаснут через 4 с, остаются квадратики: ищем по title.
      legendZone: /место замечания/i.test(
        document.querySelector("[title*='место замечания']")?.getAttribute("title") ?? "",
      ),
      legendHits: /спорное значение/i.test(
        document.querySelector("[title*='место замечания']")?.getAttribute("title") ?? "",
      ),
    };
  });

  const label = `#${review.number ?? index} стр.${loc.pageNumber} «${loc.quote.slice(0, 34)}»`;
  console.log(`\n${label}`);
  console.log("   ", JSON.stringify(info));

  check(`${index}. подсветка найдена`, (info.foundCount ?? 0) > 0 || info.zones > 0, `найдено: ${info.foundCount}`);
  check(
    `${index}. нет лишней плашки «Цитата не найдена»`,
    !(info.quoteMissBanner && (info.foundCount ?? 0) > 0),
    info.quoteMissBanner ? "плашка есть" : "плашки нет",
  );
  check(`${index}. нет полоски «Лист открыт из разбора»`, !info.peekStrip);
  check(`${index}. нет ссылки «Файл в новой вкладке»`, !info.newTabLink);
  if (loc.rect) {
    check(
      `${index}. зелёная рамка места на листе`,
      info.greenRects > 0,
      `зелёных: ${info.greenRects}, синих: ${info.blueRects}`,
    );
    check(
      `${index}. легенда цветов видна`,
      info.legendZone && info.legendHits,
      `место: ${info.legendZone}, значение: ${info.legendHits}`,
    );
    check(
      `${index}. подсветка значения только в рамке`,
      (info.foundCount ?? 0) <= 2,
      `найдено: ${info.foundCount}`,
    );
  }

  await page.screenshot({ path: join(shots, `prod-quote-banner-${index}.png`) });

  // Комплект PDF+DWG: то же место на вкладке DWG.
  const dwgTab = page.getByRole("tab", { name: /^DWG$/ }).first();
  if (index === 1 && (await dwgTab.count())) {
    await dwgTab.click();
    await page.waitForTimeout(6000);
    const cad = await page.evaluate(() => {
      const text = document.body.innerText;
      const found = text.match(/найдено:\s*(\d+)/i);
      return {
        foundCount: found ? Number(found[1]) : null,
        quoteMissBanner: /цитата не найдена/i.test(text),
        noLayerBanner: /нет текстового слоя/i.test(text),
        cyrillic: /[А-Яа-яЁё]{4,}/.test(text),
      };
    });
    console.log("    DWG", JSON.stringify(cad));
    check(
      "DWG: плашка только при нуле находок",
      !(cad.quoteMissBanner && (cad.foundCount ?? 0) > 0),
      `найдено: ${cad.foundCount}, плашка: ${cad.quoteMissBanner}`,
    );
    await page.screenshot({ path: join(shots, "prod-quote-banner-dwg.png") });
  }
}

const grouped = aiReviews.find((item) => (item.locations || []).length > 1);
if (grouped) {
  const loc = grouped.locations[0];
  await page.goto(
    `${BASE}/?project=${project.id}&doc=${loc.documentId}&page=${loc.pageNumber}` +
      `&from=reviews&review=${grouped.id}&quote=${encodeURIComponent(loc.quote || "")}`,
    { waitUntil: "domcontentloaded", timeout: 90000 },
  );
  await page.waitForTimeout(6000);
  const bar = await page.evaluate(() =>
    /Место\s+\d+\s+из\s+\d+/i.test(document.body.innerText),
  );
  check("«Место N из M» на групповом замечании", bar, `мест: ${grouped.locations.length}`);
  await page.screenshot({ path: join(shots, "prod-quote-banner-group.png") });
} else {
  console.log("—   групповых замечаний нет, полосу «Место N из M» не проверяем");
}

console.log("\nCONSOLE", logs.slice(0, 10));
const failed = checks.filter((item) => !item.pass);
console.log(
  failed.length ? `\nVERIFY FAIL ${failed.length}: ${failed.map((i) => i.name).join("; ")}` : "\nVERIFY PASS",
);
await browser.close();
process.exit(failed.length ? 1 : 0);
