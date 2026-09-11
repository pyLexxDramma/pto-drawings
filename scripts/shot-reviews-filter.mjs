/**
 * Скриншот таблицы замечаний, открытой из файла: чип «Только этот файл» должен
 * быть включён и заметен.
 *   node scripts/shot-reviews-filter.mjs --project=<id> --doc=<id>
 */
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const shots = join(__dirname, "..", "samples", "shots");
mkdirSync(shots, { recursive: true });

const base = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";
const arg = (name) => {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1600, height: 950 },
});
await ctx.request.post(`${base}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
  timeout: 60000,
});
const page = await ctx.newPage();
await page.goto(
  `${base}/?project=${arg("project")}&doc=${arg("doc")}&page=1`,
  { waitUntil: "domcontentloaded", timeout: 120000 },
);
await page.waitForTimeout(4000);
await page.getByText("Таблица замечаний").first().click();
await page.waitForTimeout(3000);

const chip = page.getByRole("button", { name: /этот файл/i }).first();
const label = (await chip.count()) ? (await chip.textContent())?.trim() : "нет чипа";
const rows = await page.locator("table tbody tr").count();
console.log("чип:", label, "| строк в таблице:", rows);
await page.screenshot({ path: join(shots, "reviews-filter-on.png") });

if (await chip.count()) {
  await chip.click();
  await page.waitForTimeout(1500);
  console.log(
    "после клика:",
    (await chip.textContent())?.trim(),
    "| строк:",
    await page.locator("table tbody tr").count(),
  );
  await page.screenshot({ path: join(shots, "reviews-filter-off.png") });
}

await browser.close();
console.log("скриншоты:", shots);
