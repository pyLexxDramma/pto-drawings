/**
 * Легенда не должна дёргаться под курсором: строка плашек центрирована, поэтому
 * любое расширение легенды на ховере уводило её из-под мыши.
 *   PTO_PASSWORD=... node scripts/shot-legend-jitter.mjs
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const shots = join(dirname(fileURLToPath(import.meta.url)), "..", "samples", "shots");
const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1600, height: 950 },
});
const auth = await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
  timeout: 60000,
});
if (!auth.ok()) {
  console.log("вход не прошёл:", auth.status(), "— задайте PTO_PASSWORD");
  await browser.close();
  process.exit(1);
}

const { projects = [] } = await (await ctx.request.get(`${BASE}/api/projects`)).json();
let target = null;
for (const project of projects) {
  const { reviews = [] } = await (
    await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
  ).json();
  const hit = reviews
    .flatMap((review) =>
      (review.locations || [])
        .filter((loc) => loc.rect)
        .map((loc) => ({ project, review, loc })),
    )
    .at(0);
  if (hit) {
    target = hit;
    break;
  }
}
if (!target) {
  console.log("нет места с рамкой — нечего проверять");
  await browser.close();
  process.exit(1);
}

const page = await ctx.newPage();
await page.goto(
  `${BASE}/?project=${target.project.id}&doc=${target.loc.documentId}` +
    `&page=${target.loc.pageNumber}&from=reviews&review=${target.review.id}` +
    `&quote=${encodeURIComponent(target.loc.quote)}`,
  { waitUntil: "domcontentloaded", timeout: 90000 },
);

const legend = page.locator("[title*='Оранжевым'], [title*='Зелёная рамка']").first();
await legend.waitFor({ timeout: 60000 });
const bar = legend.locator("xpath=../..");

// Стартовые подписи гаснут через три секунды, а состав квадратиков доезжает
// вместе с подсветкой соседних мест. Ждём, пока и то и другое устоится.
await page.waitForTimeout(3800);
let collapsed = await legend.boundingBox();
let steady = 0;
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(250);
  const box = await legend.boundingBox();
  const same =
    Math.round(box.width) === Math.round(collapsed.width) &&
    Math.round(box.x) === Math.round(collapsed.x);
  steady = same ? steady + 1 : 0;
  collapsed = box;
  if (steady >= 12) break;
}
await bar.screenshot({ path: join(shots, "legend-collapsed.png") });

const center = {
  x: collapsed.x + collapsed.width / 2,
  y: collapsed.y + collapsed.height / 2,
};
await page.mouse.move(center.x, center.y);
await page.waitForTimeout(150);

const samples = [];
for (let i = 0; i < 14; i += 1) {
  await page.waitForTimeout(120);
  const box = await legend.boundingBox();
  samples.push({ x: Math.round(box.x), w: Math.round(box.width) });
}
await bar.screenshot({ path: join(shots, "legend-hover.png") });

const xs = samples.map((s) => s.x);
const ws = samples.map((s) => s.w);
const spread = Math.max(...xs) - Math.min(...xs);
const widthSpread = Math.max(...ws) - Math.min(...ws);
// Подписи зависят от того, что подсвечено на листе, поэтому проверяем не текст,
// а сам слой: он лежит поверх и не участвует в раскладке строки.
const labels = await legend.evaluate((el) => {
  const panel = el.querySelector(":scope > span[class*='absolute']");
  if (!panel) return null;
  return {
    text: (panel.textContent || "").trim(),
    inFlow: getComputedStyle(panel).position !== "absolute",
  };
});
const labelsVisible = Boolean(labels && labels.text && !labels.inFlow);

console.log("свёрнутая легенда:", Math.round(collapsed.width), "px");
console.log("замеры под курсором:", JSON.stringify(samples));
console.log("разброс x:", spread, "px · разброс ширины:", widthSpread, "px");
console.log("подписи под курсором:", labels ? labels.text : "нет слоя");
console.log(
  spread === 0 && widthSpread === 0 && labelsVisible
    ? "ОК: легенда стоит на месте, подписи держатся"
    : "ПРОБЛЕМА: легенда всё ещё смещается или подписи мигают",
);
await browser.close();
