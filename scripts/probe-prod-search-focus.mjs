/** Поиск по листу: подводит ли кадр к совпадению и листаются ли они. */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const shots = join(dirname(fileURLToPath(import.meta.url)), "..", "samples", "shots");
const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const DOC = process.env.PTO_DOC;
const PROJECT = process.env.PTO_PROJECT_ID;
const QUERY = process.env.PTO_QUERY || "Т1.1 Т2.1 от котлов";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 950 } });
await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: process.env.PTO_LOGIN, password: process.env.PTO_PASSWORD },
  timeout: 60000,
});

const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`);
});
await page.goto(`${BASE}/?project=${PROJECT}&doc=${DOC}&page=1`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
await page.waitForTimeout(6000);

const scaleBefore = await page.locator("[data-viewer-scale]").first().innerText();
console.log("масштаб до поиска:", scaleBefore);

await page.keyboard.press("/");
await page.waitForTimeout(600);
const field = page.getByPlaceholder(/поиск/i).first();
const hasField = (await field.count()) > 0;
console.log("поле поиска:", hasField);
if (hasField) {
  await field.fill(QUERY);
} else {
  await page.keyboard.type(QUERY);
}
await page.waitForTimeout(6000);

const read = async () => {
  const badge = await page.evaluate(() => {
    const m = document.body.innerText.match(/найдено:\s*(\d+)(?:\s*·\s*(\d+))?/i);
    return m ? { count: Number(m[1]), index: m[2] ? Number(m[2]) : null } : null;
  });
  const scale = await page.locator("[data-viewer-scale]").first().innerText();
  return { badge, scale };
};

const first = await read();
console.log("после поиска:", JSON.stringify(first));
await page.screenshot({ path: join(shots, "prod-search-focus-1.png") });

const next = page.getByRole("button", { name: "Следующее совпадение" }).first();
console.log("стрелка вперёд:", (await next.count()) > 0);
if (await next.count()) {
  await next.click();
  await page.waitForTimeout(2500);
  const second = await read();
  console.log("после →:", JSON.stringify(second));
  await page.screenshot({ path: join(shots, "prod-search-focus-2.png") });
}

console.log("CONSOLE", logs.slice(0, 8));
await browser.close();
