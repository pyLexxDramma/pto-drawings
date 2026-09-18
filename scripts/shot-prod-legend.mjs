/**
 * Крупные снимки легенды цветов и рамки места — для созвона.
 *   PTO_PASSWORD=... node scripts/shot-prod-legend.mjs
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const shots = join(dirname(fileURLToPath(import.meta.url)), "..", "samples", "shots");
const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";
const FILE_RE = new RegExp(process.env.PTO_FILE || "Северный", "i");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1600, height: 950 },
  deviceScaleFactor: 2,
});
await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
  timeout: 60000,
});

const { projects = [] } = await (await ctx.request.get(`${BASE}/api/projects`)).json();
const project = projects[0];
const { documents = [] } = await (
  await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
).json();
const { reviews = [] } = await (
  await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
).json();

const pdfDoc = documents.find(
  (item) => FILE_RE.test(item.originalName) && /\.pdf$/i.test(item.originalName),
);
const target = reviews
  .flatMap((review) =>
    (review.locations || [])
      .filter((loc) => loc.documentId === pdfDoc?.id && loc.rect && loc.quote)
      .map((loc) => ({ review, loc })),
  )
  .at(0);
if (!target) {
  console.log("нет места с рамкой");
  await browser.close();
  process.exit(1);
}

const page = await ctx.newPage();
await page.goto(
  `${BASE}/?project=${project.id}&doc=${target.loc.documentId}&page=${target.loc.pageNumber}` +
    `&from=reviews&review=${target.review.id}&quote=${encodeURIComponent(target.loc.quote)}`,
  { waitUntil: "domcontentloaded", timeout: 90000 },
);
await page.waitForTimeout(8000);

const legend = page.getByText("место замечания").first();
const bar = legend.locator("xpath=ancestor::div[contains(@class,'top-2')][1]");
await bar.screenshot({ path: join(shots, "legend-bar.png") });

const zone = page.locator(".pto-remark-zone").first();
const box = await zone.boundingBox();
if (box) {
  await page.screenshot({
    path: join(shots, "legend-zone.png"),
    clip: {
      x: Math.max(0, box.x - 260),
      y: Math.max(0, box.y - 70),
      width: Math.min(1100, box.width + 520),
      height: Math.min(260, box.height + 150),
    },
  });
}
console.log("цитата:", target.loc.quote);
console.log("готово: samples/shots/legend-bar.png, legend-zone.png");
await browser.close();
