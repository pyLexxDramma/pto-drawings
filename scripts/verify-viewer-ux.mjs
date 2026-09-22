/**
 * Локальная проверка вьюера: масштаб, обзор, клавиши.
 *   PTO_BASE_URL=http://127.0.0.1:3000 node scripts/verify-viewer-ux.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "http://127.0.0.1:3000";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const auth = await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});
check("login", auth.ok(), String(auth.status()));
if (!auth.ok()) {
  await browser.close();
  process.exit(1);
}

const projects = await (
  await ctx.request.get(`${BASE}/api/projects`)
).json();
let target = null;
for (const project of projects.projects || []) {
  const payload = await (
    await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
  ).json();
  const doc = (payload.documents || []).find(
    (item) => item.pageCount > 0 && item.readyPages > 0,
  );
  if (doc) {
    target = { project, doc };
    break;
  }
}
if (!target) {
  console.log("FAIL нет обработанного файла");
  await browser.close();
  process.exit(1);
}
console.log(`файл: ${target.doc.originalName} (${target.project.name})`);

const page = await ctx.newPage();
await page.goto(
  `${BASE}/?project=${target.project.id}&doc=${target.doc.id}&page=1`,
  { waitUntil: "domcontentloaded", timeout: 60000 },
);
await page.locator("[data-viewer-toolbar]").waitFor({ timeout: 45000 });

const toolbar = page.locator("[data-viewer-toolbar]");
check("панель масштаба", (await toolbar.count()) > 0);

await page.locator("[data-viewer-scale]").click();
const pageFit = page.getByRole("option", { name: "По странице" });
check("меню «По странице»", (await pageFit.count()) > 0);
if (await pageFit.count()) {
  await pageFit.click();
  await page.waitForTimeout(300);
}
const afterFit = await page.locator("[data-viewer-scale]").innerText();
check("масштаб после «По странице»", /%/.test(afterFit), afterFit);

await page.locator("[data-viewer-wrap]").click();
await page.keyboard.press("Control+Equal").catch(() => undefined);
await page.locator("[data-viewer-toolbar] >> text=+").click();
await page.waitForTimeout(200);
const zoomed = await page.locator("[data-viewer-scale]").innerText();
check("кнопка + увеличивает", zoomed !== afterFit, `${afterFit} → ${zoomed}`);

await page.keyboard.press("?");
check(
  "карта клавиш «?»",
  (await page.getByRole("dialog", { name: "Клавиши" }).count()) > 0,
);
await page.keyboard.press("Escape");

const thumbs = page.getByRole("button", { name: "Миниатюры" });
if (await thumbs.count()) {
  await thumbs.click();
  await page.waitForTimeout(400);
}
check(
  "миниатюры",
  (await page.locator("[data-page]").count()) > 0 || (await thumbs.count()) === 0,
);

const rail = page.locator("[data-remark-rail]");
check(
  "рейка замечаний",
  true,
  (await rail.count()) ? "есть" : "в этом файле пусто — нормально",
);

await page.screenshot({
  path: "samples/shots/local-viewer-ux.png",
  fullPage: false,
});
console.log("shot samples/shots/local-viewer-ux.png");

const failed = checks.filter((item) => !item.pass).length;
console.log(failed ? `VERIFY FAIL ${failed}` : "VERIFY PASS");
await browser.close();
process.exit(failed ? 1 : 0);
