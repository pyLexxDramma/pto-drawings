/**
 * Проверка десктопного адаптива: колонка проектов, плотность текста и таблица
 * на трёх диагоналях. Скриншоты кладём в samples/shots/density-*.png.
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.PTO_BASE_URL || "http://localhost:8080";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";
const OUT_DIR = path.resolve("samples/shots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const SIZES = [
  { tag: "1280", width: 1280, height: 800 },
  { tag: "1680", width: 1680, height: 1000 },
  { tag: "2560", width: 2560, height: 1400 },
];

const browser = await chromium.launch();

for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
  });
  const auth = await context.request.post(`${BASE}/api/auth/login`, {
    data: { login: LOGIN, password: PASSWORD },
  });
  if (!auth.ok()) {
    console.error("login failed", auth.status());
    await browser.close();
    process.exit(1);
  }

  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);

  const scale = await page.evaluate(() => ({
    sm: getComputedStyle(document.documentElement).getPropertyValue("--ui-t-sm"),
    measure: getComputedStyle(document.documentElement).getPropertyValue(
      "--md-measure",
    ),
  }));
  const aside = await page.locator("aside").first();
  const asideBox = (await aside.count()) ? await aside.boundingBox() : null;
  console.log(
    `${size.tag}: --ui-t-sm=${scale.sm.trim()} measure=${scale.measure.trim()} aside=${asideBox ? Math.round(asideBox.width) : "нет"}`,
  );

  await page.screenshot({
    path: path.join(OUT_DIR, `density-${size.tag}-home.png`),
  });

  // Первый проект и таблица замечаний.
  const rows = page.locator("[data-project-row]");
  if (await rows.count()) {
    await rows.first().locator("button").first().click();
    await page.waitForTimeout(2000);
    const stage = page.getByRole("button", { name: /^Таблица замечаний / });
    if (await stage.count()) {
      await stage.first().click();
      await page.waitForTimeout(2000);
      await page.screenshot({
        path: path.join(OUT_DIR, `density-${size.tag}-table.png`),
      });
    }
    const sheet = page.getByRole("button", { name: /^Расшифровка / });
    if (await sheet.count()) {
      await sheet.first().click();
      await page.waitForTimeout(3500);
      await page.screenshot({
        path: path.join(OUT_DIR, `density-${size.tag}-sheet.png`),
      });
      const collapsed = await page
        .getByRole("button", { name: "Показать проекты и листы" })
        .count();
      console.log(`${size.tag}: дерево свёрнуто = ${collapsed > 0}`);
    }
  } else {
    console.log(`${size.tag}: проектов нет — только главная`);
  }

  await context.close();
}

await browser.close();
console.log("готово:", OUT_DIR);
