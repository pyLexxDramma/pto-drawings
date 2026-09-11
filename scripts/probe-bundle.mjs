import { chromium } from "playwright";

const BASE = "https://pto.tw1.su";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
const all = await page.evaluate(() =>
  [...document.querySelectorAll("script[src]")].map((s) => s.src),
);
const found = [];
for (const url of all) {
  if (!url.includes("/_next/static/chunks/")) continue;
  const t = await (await ctx.request.get(url)).text();
  const hits = [];
  if (t.includes("arrayBuffer")) hits.push("arrayBuffer");
  if (t.includes("disableRange")) hits.push("disableRange");
  if (t.includes("RenderingCancelledException")) hits.push("RenderingCancelled");
  if (t.includes("pdf.worker.min.mjs")) hits.push("workerSrc");
  if (t.includes("Не удалось показать страницу")) hits.push("errMsg");
  if (hits.length) found.push({ url: url.slice(-70), hits });
}
console.log(JSON.stringify(found, null, 2));
await browser.close();
