/**
 * Playwright smoke на https://pto.tw1.su — уже загруженный файл.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

const results = { base: BASE, ok: false, checks: [] };
function check(name, pass, detail = "") {
  results.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

try {
  const loginRes = await context.request.post(`${BASE}/api/auth/login`, {
    data: { login: LOGIN, password: PASSWORD },
  });
  check("login", loginRes.ok(), String(loginRes.status()));
  if (!loginRes.ok()) throw new Error("login failed");

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 });

  check("Проекты видны", await page.getByText("Проекты").first().isVisible());
  const collapsed = page.locator('button[title="Показать файлы"]');
  check(
    "файлы сразу открыты (не отдельный рельс)",
    !(await collapsed.isVisible().catch(() => false)) &&
      (await page.getByText(/Чертежи проекта|Добавить ещё файлы|Перетащите/i).count()) > 0,
  );

  await page.getByRole("button", { name: "lexxdramma_test" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "stroitelnyy-chertezh.pdf" }).click();
  await page.getByRole("button", { name: /На главную/ }).waitFor({ timeout: 30000 });
  check("открыт stroitelnyy-chertezh.pdf", true);

  await page.waitForSelector("[data-md-block], .markdown-body", { timeout: 30000 });
  // PDF canvas must stay mounted (не iframe fallback)
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector("canvas");
      const iframe = document.querySelector("iframe[title='PDF']");
      return !!canvas && !iframe && canvas.width > 100;
    },
    null,
    { timeout: 90000 },
  );
  await page.waitForFunction(
    () => Number(document.querySelector("[data-sync-regions]")?.getAttribute("data-sync-regions") || 0) > 0,
    null,
    { timeout: 45000 },
  ).catch(() => {});
  const syncMeta = await page.evaluate(() => ({
    regions: document.querySelector("[data-sync-regions]")?.getAttribute("data-sync-regions"),
    links: document.querySelector("[data-sync-links]")?.getAttribute("data-sync-links"),
    canvas: !!document.querySelector("canvas"),
    iframe: !!document.querySelector("iframe[title='PDF']"),
  }));
  check(
    "зоны текста PDF извлечены",
    Number(syncMeta.regions) > 0,
    `regions=${syncMeta.regions} links=${syncMeta.links} canvas=${syncMeta.canvas} iframe=${syncMeta.iframe}`,
  );
  await page.waitForTimeout(500);

  const sheet = page.locator("text=/лист\\s+\\d+\\s+из\\s+\\d+/i").first();
  check("навигация по листам", await sheet.isVisible(), (await sheet.textContent())?.trim() || "");

  const blocks = page.locator("[data-md-block]");
  await blocks.first().waitFor({ timeout: 15000 });
  const blockCount = await blocks.count();
  check("блоки расшифровки", blockCount > 0, `count=${blockCount}`);

  // Prefer blocks that look like drawing labels (Latin)
  const indices = [];
  for (let i = 0; i < blockCount; i += 1) {
    const text = ((await blocks.nth(i).innerText()) || "").trim();
    if (/[A-Za-z]{3,}/.test(text) && text.length >= 12) indices.push(i);
  }
  const tryOrder = indices.length ? indices.slice(0, 25) : [...Array(Math.min(blockCount, 20)).keys()];

  let textHover = false;
  let overlayOk = false;
  for (const i of tryOrder) {
    const block = blocks.nth(i);
    const text = ((await block.innerText()) || "").trim();
    await block.scrollIntoViewIfNeeded();
    await block.hover({ force: true });
    await page.waitForTimeout(500);
    const hovered = (await block.getAttribute("data-md-block-hover")) === "true";
    const emerald = await block.evaluate((el) => String(el.className).includes("emerald"));
    const overlayInfo = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("div")].filter((el) =>
        /emerald/i.test(el.className) && el.className.includes("absolute"),
      );
      return {
        count: nodes.length,
        sample: nodes.slice(0, 2).map((el) => el.className),
      };
    });
    if (hovered || emerald) {
      textHover = true;
      if (overlayInfo.count > 0) {
        overlayOk = true;
        console.log(`  text→draw i=${i} overlays=${overlayInfo.count} «${text.slice(0, 70)}»`);
        break;
      }
    }
  }
  check("hover текста → emerald блок", textHover);
  check("hover текста → участок на чертеже", overlayOk);

  // Hover drawing → text
  let reverse = false;
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (box) {
    for (const [fx, fy] of [
      [0.35, 0.35],
      [0.5, 0.4],
      [0.6, 0.5],
      [0.45, 0.55],
      [0.55, 0.3],
      [0.7, 0.45],
      [0.3, 0.6],
      [0.4, 0.45],
      [0.5, 0.6],
      [0.25, 0.4],
    ]) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(350);
      if ((await page.locator('[data-md-block-hover="true"]').count()) > 0) {
        reverse = true;
        const t = await page.locator('[data-md-block-hover="true"]').first().innerText();
        console.log(`  draw→text «${t.slice(0, 70).replace(/\s+/g, " ")}»`);
        break;
      }
    }
  }
  check("hover чертежа → подсветка расшифровки", reverse);

  // Gallery
  const galleryBtn = page.locator('button[title*="Все листы"], button[title*="Вернуться"]');
  check("кнопка галереи", (await galleryBtn.count()) > 0);
  await galleryBtn.first().click();
  await page.waitForTimeout(800);
  check(
    "галерея всех листов",
    await page.getByText("клик — открыть для проверки").isVisible().catch(() => false),
  );
  await page.locator('button[title*="Вернуться"], button[title*="Все листы"]').first().click();
  await page.waitForTimeout(600);

  // ⋯ help
  await page.locator('button[title="Ещё"]').click();
  await page.waitForTimeout(300);
  check("справка в ⋯", await page.getByText("Справка").first().isVisible());
  check(
    "синхронный скролл в ⋯",
    await page.getByRole("menuitem", { name: /Синхронный скролл/ }).first().isVisible(),
  );
  await page.keyboard.press("Escape");

  results.ok = results.checks.every((c) => c.pass);
} catch (err) {
  results.ok = false;
  results.error = err instanceof Error ? err.message : String(err);
  console.error("ERROR", results.error);
} finally {
  await page
    .screenshot({
      path: path.join(ROOT, "logs", "prod-verify.png"),
      timeout: 8000,
      animations: "disabled",
    })
    .catch(() => {});
  fs.writeFileSync(path.join(ROOT, "logs", "prod-verify.json"), JSON.stringify(results, null, 2));
  console.log("\n" + (results.ok ? "ALL PASS" : "HAS FAILURES"));
  await browser.close();
  process.exit(results.ok ? 0 : 1);
}
