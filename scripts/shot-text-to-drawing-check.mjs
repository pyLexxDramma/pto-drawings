/**
 * Эксперимент 0102: выделил фрагмент расшифровки — есть ли участок на чертеже.
 * Печатает попадания по типам листов фикстуры. Выключенный тумблер ничего не делает.
 *
 *   PTO_BASE_URL=http://127.0.0.1:3200 node scripts/shot-text-to-drawing-check.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "http://127.0.0.1:3200";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const auth = await context.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
  timeout: 60000,
});
if (!auth.ok()) {
  console.error(`login failed ${auth.status()}`);
  await browser.close();
  process.exit(1);
}

const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
const rows = page.locator("[data-project-row]");
await rows.first().waitFor({ timeout: 90000 });
const fixture = rows.filter({ hasText: "UI-фикстура" });
await ((await fixture.count()) ? fixture.first() : rows.first())
  .locator("button")
  .first()
  .click();
await page.waitForTimeout(1500);
const stage = page.getByRole("button", { name: /^Расшифровка / });
if (await stage.count()) {
  await stage.first().click();
  await page.waitForTimeout(1500);
}

const toggle = page.locator("[data-text-link-toggle]").first();
await toggle.waitFor({ timeout: 30000 });
const pressedOff = await toggle.getAttribute("aria-pressed");
console.log(`тумблер по умолчанию aria-pressed=${pressedOff}`);
if (pressedOff !== "false") {
  console.error("FAIL тумблер должен быть выключен");
  await browser.close();
  process.exit(1);
}

await toggle.click();
await page.waitForTimeout(300);
console.log(`после включения aria-pressed=${await toggle.getAttribute("aria-pressed")}`);

async function openSheet(index) {
  const sheets = page.locator("[data-page-strip] [data-page]");
  await sheets.first().waitFor({ timeout: 30000 });
  await sheets.nth(index).click();
  await page.waitForTimeout(1500);
}

async function expand(title) {
  const head = page.locator("[data-sheet-section] button").filter({ hasText: title }).first();
  if (!(await head.count())) return;
  const open = await head.getAttribute("aria-expanded");
  if (open !== "true") await head.click();
  await page.waitForTimeout(400);
}

/** Выделяет фразу в расшифровке и ждёт ответ эксперимента. */
async function probe(label, phrase) {
  const selected = await page.evaluate((needle) => {
    const root = document.querySelector("[data-sheet-body]");
    if (!root) return "нет листа";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent || "";
      const at = text.indexOf(needle);
      if (at >= 0) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, Math.min(text.length, at + needle.length));
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return "ok";
      }
      node = walker.nextNode();
    }
    return "фразы нет";
  }, phrase);
  if (selected !== "ok") {
    console.log(`FAIL ${label} — ${selected}`);
    return;
  }
  const status = page.locator("[data-exp-status]").first();
  try {
    await status.waitFor({ timeout: 8000 });
  } catch {
    console.log(`FAIL ${label} — ответа нет`);
    return;
  }
  const started = Date.now();
  let value = await status.getAttribute("data-exp-status");
  while (value === "pending" && Date.now() - started < 8000) {
    await page.waitForTimeout(200);
    value = await status.getAttribute("data-exp-status");
  }
  const text = ((await status.textContent()) || "").trim();
  const zones = await page.locator("[data-text-link-hit]").count();
  console.log(`${label}: ${value} — ${text} — рамок ${zones}`);
}

await openSheet(1);
await expand("Текст листа");
await probe("чертёж, фраза есть в текстовом слое", "FIRST FLOOR PLAN");
await probe("чертёж, фраза только в расшифровке", "Колодец К-4");

await openSheet(0);
await probe("таблица, фраза есть в текстовом слое", "BASEMENT FOUNDATION PLAN");
await probe("таблица, строка только в расшифровке", "Швеллер горячекатаный 20У");

await openSheet(3);
await expand("Описание чертежа");
await probe("скан, цитата модели без координат", "250 кВт");

await browser.close();
