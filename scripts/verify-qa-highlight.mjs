/**
 * Только проверка подсветки на уже загруженном QA kit.
 * PTO_PROJECT_ID / PTO_DOC_ID обязательны.
 */
import { chromium } from "playwright";

const base = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const projectId = process.env.PTO_PROJECT_ID;
const documentId = process.env.PTO_DOC_ID;
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

if (!projectId || !documentId) {
  console.error("Need PTO_PROJECT_ID and PTO_DOC_ID");
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
await ctx.request.post(`${base}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});
const payload = await (
  await ctx.request.get(`${base}/api/projects/${projectId}/reviews`)
).json();
const reviews = payload.reviews || [];
console.log(
  "reviews",
  reviews.map((r) => `${r.number}:${r.locations?.[0]?.quote || "-"}`).join(" | "),
);
const target =
  reviews.find((r) =>
    (r.locations || []).some((l) => /масштаб чертежа/i.test(l.quote || "")),
  ) ||
  reviews.find((r) => (r.locations || []).some((l) => (l.quote || "").length > 5)) ||
  reviews[0];
if (!target?.locations?.[0]) {
  console.error("No review with location");
  process.exit(1);
}
const loc =
  target.locations.find((l) => (l.quote || "").length > 5) || target.locations[0];
const url = `${base}/?project=${projectId}&doc=${documentId}&page=${loc.pageNumber}&from=reviews&review=${target.id}&quote=${encodeURIComponent(loc.quote)}`;
console.log("goto", url);
const page = await ctx.newPage();
let loaded = false;
for (let i = 0; i < 5; i++) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    loaded = true;
    break;
  } catch (err) {
    console.log("goto retry", i + 1, err.message.split("\n")[0]);
    await page.waitForTimeout(3000 * (i + 1));
  }
}
if (!loaded) throw new Error("goto failed");
await page
  .getByText("Загрузка…")
  .waitFor({ state: "hidden", timeout: 60000 })
  .catch(() => {});
await page.waitForTimeout(4000);
const zone = await page.locator(".pto-remark-zone").count();
const mark = await page
  .locator("mark.pto-remark-text, mark[data-focus-quote]")
  .count();
const banner = await page.getByText(/цитата не найдена|смотри текст/i).count();
const topToolbar = await page
  .locator(
    'button[aria-label="Весь экран"], button[aria-label="Предыдущий лист"]',
  )
  .count();
const bottomOld = await page.getByText("Пред. лист").count();
const listClickable = await page
  .getByRole("button", { name: /№\s*\d+/i })
  .count();
console.log(
  JSON.stringify(
    { zone, mark, banner, topToolbar, bottomOld, listClickable, quote: loc.quote },
    null,
    2,
  ),
);
if (listClickable > 0) {
  await page.getByRole("button", { name: /№\s*\d+/i }).first().click();
  await page.waitForTimeout(1500);
  const after = await page
    .locator("mark[data-focus-quote], .pto-remark-zone")
    .count();
  console.log("after list click hits=", after);
}
await browser.close();
const ok = zone > 0 || mark > 0 || banner > 0;
console.log(ok ? "VERIFY PASS" : "VERIFY FAIL");
process.exit(ok ? 0 : 1);
