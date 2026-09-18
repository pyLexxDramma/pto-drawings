/**
 * Миниатюры: точка «не просмотрен» и подпись типа листа только по наведению.
 *   PTO_BASE_URL=https://pto.tw1.su node scripts/probe-prod-thumbs.mjs
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
await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});
const projects = await (await ctx.request.get(`${BASE}/api/projects`)).json();
let target = null;
// Нужен файл, где есть готовый, но не открытый лист — иначе пустой точке
// взяться неоткуда.
for (const project of projects.projects || []) {
  const docs = await (
    await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
  ).json();
  for (const doc of (docs.documents || []).filter((item) => item.readyPages > 1)) {
    const progress = await (
      await ctx.request.get(`${BASE}/api/documents/${doc.id}/progress`)
    ).json();
    const seen = new Set(progress.progress?.viewed || []);
    if (seen.size < doc.readyPages) {
      target = { project, doc, unseen: doc.readyPages - seen.size };
      break;
    }
  }
  if (target) break;
}
if (!target) {
  console.log("FAIL нет файла с двумя готовыми листами");
  await browser.close();
  process.exit(1);
}
console.log(
  `файл: ${target.doc.originalName} (${target.project.name}) · не открыто листов: ${target.unseen}`,
);

const page = await ctx.newPage();
await page.goto(
  `${BASE}/?project=${target.project.id}&doc=${target.doc.id}&page=1`,
  { waitUntil: "domcontentloaded", timeout: 90000 },
);
await page.locator("[data-viewer-toolbar]").waitFor({ timeout: 60000 });
await page.waitForTimeout(2000);

const unseen = page.locator("[title='Лист не просмотрен']");
check("точка «лист не просмотрен»", (await unseen.count()) > 0, `точек: ${await unseen.count()}`);

const tile = page.locator("[data-page]").first();
const kindLabel = tile.locator("div").last();
const before = await kindLabel.evaluate((node) =>
  getComputedStyle(node).opacity,
);
check("подпись типа листа скрыта", before === "0", `opacity: ${before}`);
await tile.hover();
await page.waitForTimeout(400);
const after = await kindLabel.evaluate((node) => getComputedStyle(node).opacity);
check("подпись появляется по наведению", after === "1", `opacity: ${after}`);
const tileBox = await tile.boundingBox();
if (tileBox) {
  await page.screenshot({
    path: "samples/shots/fix-thumb-dots.png",
    clip: {
      x: Math.max(0, tileBox.x - 6),
      y: Math.max(0, tileBox.y - 6),
      width: tileBox.width + 12,
      height: Math.min(520, tileBox.height * 3 + 24),
    },
  });
}

const failed = checks.filter((item) => !item.pass).length;
console.log(failed ? `VERIFY FAIL ${failed}` : "VERIFY PASS");
await browser.close();
process.exit(failed ? 1 : 0);
