/**
 * Проверка подсветки по замечаниям комплекта PDF+DXF на проде.
 *   node scripts/verify-kit-highlight.mjs --project=<id> --pdf=<id> --cad=<id>
 * Скриншоты кладёт в samples/shots/.
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
const projectId = arg("project");
const pdfId = arg("pdf");
const cadId = arg("cad");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1600, height: 950 },
});
await ctx.request.post(`${base}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
  timeout: 60000,
});

const reviewsRes = await ctx.request.get(
  `${base}/api/projects/${projectId}/reviews`,
  { timeout: 60000 },
);
const { reviews } = await reviewsRes.json();
const mine = reviews.filter((r) =>
  (r.locations || []).some((l) => l.documentId === pdfId || l.documentId === cadId),
);
console.log(`замечаний по комплекту: ${mine.length}`);

const page = await ctx.newPage();
const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function openJump(docId, pageNumber, review, quote) {
  const url = `${base}/?project=${projectId}&doc=${docId}&page=${pageNumber}&from=reviews&review=${review.id}&quote=${encodeURIComponent(quote)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(4500);
}

async function measure(label, shotName) {
  const zones = await page.locator(".pto-remark-zone").count();
  const marks = await page.locator("mark[data-focus-quote], mark.pto-remark-text").count();
  const notFound = await page.getByText(/цитата не найдена/i).count();
  const wide = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".pto-remark-zone")];
    return nodes.filter((n) => {
      const s = n.style.width || "";
      const value = Number.parseFloat(s);
      return s.endsWith("%") && value > 60;
    }).length;
  });
  await page.screenshot({ path: join(shots, shotName), fullPage: false });
  check(
    label,
    zones > 0 && wide === 0 && notFound === 0,
    `zones=${zones} marks=${marks} широких=${wide} баннер=${notFound}`,
  );
  return { zones, marks, notFound, wide };
}

try {
  for (const review of mine) {
    const loc = (review.locations || []).find((l) => l.documentId === pdfId);
    if (!loc) continue;
    await openJump(pdfId, loc.pageNumber, review, loc.quote);
    await measure(
      `PDF стр.${loc.pageNumber}: «${loc.quote.slice(0, 34)}…»`,
      `pdf-p${loc.pageNumber}-${review.number}.png`,
    );
  }

  for (const review of mine.slice(0, 3)) {
    const loc = (review.locations || []).find((l) => l.documentId === cadId);
    if (!loc) continue;
    await openJump(cadId, loc.pageNumber || 1, review, loc.quote);
    await measure(
      `DXF стр.${loc.pageNumber}: «${loc.quote.slice(0, 34)}…»`,
      `dxf-${review.number}.png`,
    );
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(failed.length === 0 ? "VERIFY PASS" : `VERIFY FAIL (${failed.length})`);
console.log("скриншоты:", shots);
process.exit(failed.length === 0 ? 0 : 1);
