/**
 * Playwright smoke на https://pto.tw1.su — проекты-дерево + таб Подсветка.
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
  check(
    "нет отдельного рельса Файлы",
    !(await page.locator('button[title="Показать файлы"]').isVisible().catch(() => false)),
  );
  check(
    "дерево проектов",
    (await page.locator("[data-projects-tree]").count()) > 0,
  );

  await page.getByRole("button", { name: /lexxdramma_test/i }).first().click();
  await page.waitForTimeout(600);
  check(
    "файлы вложены в проект",
    (await page.locator("[data-project-files]").count()) > 0 &&
      (await page.getByRole("button", { name: "stroitelnyy-chertezh.pdf" }).count()) > 0,
  );

  await page.getByRole("button", { name: "stroitelnyy-chertezh.pdf" }).click();
  await page.getByRole("button", { name: /На главную/ }).waitFor({ timeout: 30000 });
  check("открыт stroitelnyy-chertezh.pdf", true);

  await page.waitForSelector("[data-md-block], .markdown-body", { timeout: 30000 });
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
    () =>
      Number(
        document.querySelector("[data-sync-regions]")?.getAttribute("data-sync-regions") || 0,
      ) > 0,
    null,
    { timeout: 45000 },
  ).catch(() => {});

  const syncMeta = await page.evaluate(() => ({
    regions: document.querySelector("[data-sync-regions]")?.getAttribute("data-sync-regions"),
    links: document.querySelector("[data-sync-links]")?.getAttribute("data-sync-links"),
  }));
  check(
    "зоны текста PDF",
    Number(syncMeta.regions) > 0,
    `regions=${syncMeta.regions} links=${syncMeta.links}`,
  );

  const highlightTab = page.getByRole("tab", { name: "Подсветка" });
  check("таб Подсветка", await highlightTab.isVisible());
  const pressedBefore = await highlightTab.getAttribute("aria-pressed");
  check("подсветка выкл по умолчанию", pressedBefore === "false" || pressedBefore === null);

  // Off: click block should not select
  const blocks = page.locator("[data-md-block]");
  await blocks.nth(10).click({ force: true });
  await page.waitForTimeout(300);
  check(
    "без режима нет selected",
    (await page.locator('[data-md-block-selected="true"]').count()) === 0,
  );

  await highlightTab.click();
  check("подсветка включена", (await highlightTab.getAttribute("aria-pressed")) === "true");

  const blockCount = await blocks.count();
  const indices = [];
  for (let i = 0; i < blockCount; i += 1) {
    const text = ((await blocks.nth(i).innerText()) || "").trim();
    if (/[A-Za-z]{3,}/.test(text) && text.length >= 12) indices.push(i);
  }
  const tryOrder = indices.length ? indices.slice(0, 30) : [...Array(Math.min(blockCount, 25)).keys()];

  let textClick = false;
  let overlayOk = false;
  for (const i of tryOrder) {
    const block = blocks.nth(i);
    const text = ((await block.innerText()) || "").trim();
    await block.scrollIntoViewIfNeeded();
    await block.click({ force: true });
    await page.waitForTimeout(450);
    const selected = (await block.getAttribute("data-md-block-selected")) === "true";
    const overlayInfo = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("div")].filter(
        (el) => /emerald/i.test(el.className) && el.className.includes("absolute"),
      );
      return { count: nodes.length };
    });
    if (selected) {
      textClick = true;
      if (overlayInfo.count > 0) {
        overlayOk = true;
        console.log(`  text→draw i=${i} «${text.slice(0, 70)}»`);
        break;
      }
    }
  }
  check("клик строки → selected", textClick);
  check("клик строки → участок на чертеже", overlayOk);

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
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(350);
      if ((await page.locator('[data-md-block-selected="true"]').count()) > 0) {
        reverse = true;
        const t = await page.locator('[data-md-block-selected="true"]').first().innerText();
        console.log(`  draw→text «${t.slice(0, 70).replace(/\s+/g, " ")}»`);
        break;
      }
    }
  }
  check("клик чертежа → строка", reverse);

  await highlightTab.click();
  check("подсветка выкл", (await highlightTab.getAttribute("aria-pressed")) === "false");
  await page.waitForTimeout(200);
  check(
    "после выкл подсветка снята",
    (await page.locator('[data-md-block-selected="true"]').count()) === 0,
  );

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
