/**
 * Проверка правок по созвону 18.09 на проде: свёрнутый блок замечаний листа,
 * чипсы мест, подсветка только выбранного, счётчик на миниатюре, рамка за краем.
 *   PTO_BASE_URL=https://pto.tw1.su PTO_LOGIN=... PTO_PASSWORD=... \
 *   node scripts/verify-viewer-fixes-prod.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 980 } });
const auth = await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});
check("вход", auth.ok(), String(auth.status()));
if (!auth.ok()) {
  await browser.close();
  process.exit(1);
}

// Ищем лист, где есть замечания: предпочитаем лист с несколькими местами.
const projects = await (await ctx.request.get(`${BASE}/api/projects`)).json();
let target = null;
for (const project of projects.projects || []) {
  const [docsPayload, reviewsPayload] = await Promise.all([
    (await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)).json(),
    (await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)).json(),
  ]);
  const docs = docsPayload.documents || [];
  const reviews = (reviewsPayload.reviews || []).filter(
    (item) => item.severity !== "skip",
  );
  for (const review of reviews) {
    const place = (review.locations || []).find((loc) => loc.pageNumber);
    if (!place) continue;
    const doc = docs.find((item) => item.id === place.documentId);
    if (!doc || !doc.pageCount) continue;
    const onSamePage = reviews.filter((item) =>
      (item.locations || []).some(
        (loc) => loc.documentId === doc.id && loc.pageNumber === place.pageNumber,
      ),
    );
    const candidate = {
      project,
      doc,
      review,
      page: place.pageNumber,
      places: (review.locations || []).filter((loc) => loc.pageNumber).length,
      sheetReviews: onSamePage.length,
    };
    if (!target || candidate.places > target.places) target = candidate;
    if (target.places > 1 && target.sheetReviews > 1) break;
  }
  if (target && target.places > 1 && target.sheetReviews > 1) break;
}
if (!target) {
  console.log("FAIL нет листа с замечаниями");
  await browser.close();
  process.exit(1);
}
console.log(
  `проект «${target.project.name}» · ${target.doc.originalName} · лист ${target.page} · замечаний на листе ${target.sheetReviews} · мест у № ${target.review.number}: ${target.places}`,
);

const page = await ctx.newPage();
await page.goto(
  `${BASE}/?project=${target.project.id}&doc=${target.doc.id}&page=${target.page}`,
  { waitUntil: "domcontentloaded", timeout: 90000 },
);
await page.locator("[data-viewer-toolbar]").waitFor({ timeout: 60000 });
await page.waitForTimeout(1500);

const header = page.getByRole("button", { name: /Замечаний по листу/ });
check("шапка «Замечаний по листу»", (await header.count()) > 0);
const rowsCollapsed = await page
  .locator("ul.max-h-40 > li")
  .count()
  .catch(() => 0);
check("список свёрнут по умолчанию", rowsCollapsed === 0, `строк: ${rowsCollapsed}`);
await page.screenshot({ path: "samples/shots/fix-collapsed.png" });

await header.first().click();
await page.waitForTimeout(400);
const rowsOpen = await page.locator("ul.max-h-40 > li").count();
check("раскрывается по клику", rowsOpen > 0, `строк: ${rowsOpen}`);
await page.screenshot({ path: "samples/shots/fix-expanded.png" });

const chips = page.locator("ul.max-h-40 span:has-text('места:')");
check(
  "чипсы мест в строке",
  target.places > 1 ? (await chips.count()) > 0 : true,
  target.places > 1 ? `строк с чипсами: ${await chips.count()}` : "мест по одному — чипсы не нужны",
);

const flagsBefore = await page.locator("mark[class*='bg-rose-200']").count();
await page
  .locator("ul.max-h-40 > li")
  .first()
  .locator("button")
  .first()
  .click();
await page.waitForTimeout(1200);
const rowsAfterPick = await page.locator("ul.max-h-40 > li").count();
check("после выбора список сворачивается", rowsAfterPick === 0, `строк: ${rowsAfterPick}`);
const flagsAfter = await page.locator("mark[class*='bg-rose-200']").count();
check(
  "подсветка только выбранного",
  target.sheetReviews > 1 ? flagsAfter <= flagsBefore : true,
  `мест подсвечено: ${flagsBefore} → ${flagsAfter}`,
);
await page.screenshot({ path: "samples/shots/fix-picked.png" });

const headerChips = page.locator("span:has-text('места:')");
check(
  "чипсы мест в свёрнутой шапке",
  target.places > 1 ? (await headerChips.count()) > 0 : true,
);

const thumbs = page.getByRole("button", { name: "Миниатюры" });
if (await thumbs.count()) {
  await thumbs.first().click();
  await page.waitForTimeout(800);
}
const counter = page.locator("[title^='Замечаний:']");
check("счётчик замечаний на миниатюре", (await counter.count()) > 0, `плашек: ${await counter.count()}`);
const severityDot = page.locator("[title^='Важность:']");
check("точки важности на миниатюре нет", (await severityDot.count()) === 0);
await page.screenshot({ path: "samples/shots/fix-thumbs.png" });

// Рамка за краем листа: ведём курсор за правый край и отпускаем вне вьюера.
const markBtn = page.getByRole("button", { name: /Отметить ошибку/ });
if (await markBtn.count()) {
  await markBtn.first().click();
  await page.waitForTimeout(300);
  const wrap = page.locator("[data-viewer-wrap]").first();
  const box = await wrap.boundingBox();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, {
    steps: 8,
  });
  const preview = await page.locator("[data-mark-preview]").count();
  await page.mouse.move(box.x + box.width + 260, box.y + box.height * 0.6, {
    steps: 12,
  });
  await page.waitForTimeout(200);
  const outsideStill = await page.locator("[data-mark-preview]").count();
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const form = await page
    .getByText(/Что не так|Опишите|Замечание|Сохранить/)
    .count();
  check(
    "рамка держится за краем листа",
    outsideStill > 0,
    `рамка видна вне листа: ${outsideStill} (превью внутри: ${preview})`,
  );
  check("после отпускания вне листа замечание заводится", form > 0);
  await page.screenshot({ path: "samples/shots/fix-mark-edge.png" });
} else {
  check("кнопка «Отметить ошибку»", false, "не найдена");
}

console.log("shots: samples/shots/fix-*.png");
const failed = checks.filter((item) => !item.pass).length;
console.log(failed ? `VERIFY FAIL ${failed}` : "VERIFY PASS");
await browser.close();
process.exit(failed ? 1 : 0);
