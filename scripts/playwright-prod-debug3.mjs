import { chromium } from "playwright";
import fs from "fs";
import { getDocumentProxy, extractText } from "unpdf";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});

// list projects/files via UI + API
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 60000 });

const docs = await ctx.request.get(`${BASE}/api/documents`);
const docsJson = await docs.json().catch(() => null);
console.log("docs status", docs.status());
const list = Array.isArray(docsJson)
  ? docsJson
  : docsJson?.documents || docsJson?.items || [];
const summary = (list || []).slice(0, 30).map((d) => ({
  id: d.id,
  name: d.originalName || d.name,
  project: d.projectName || d.project || d.owner,
  pages: d.pageCount || d.pages?.length,
  mime: d.mimeType,
}));
console.log("documents", JSON.stringify(summary, null, 2));

const target =
  summary.find((d) => /stroitelnyy-chertezh/i.test(d.name || "")) || summary[0];
if (!target?.id) {
  console.log("no target");
  await browser.close();
  process.exit(1);
}

const fileRes = await ctx.request.get(
  `${BASE}/api/documents/${target.id}/file`,
);
const buf = Buffer.from(await fileRes.body());
fs.mkdirSync("logs", { recursive: true });
fs.writeFileSync("logs/probe.pdf", buf);
console.log("saved pdf", buf.length, "status", fileRes.status());

const pdf = await getDocumentProxy(new Uint8Array(buf));
const textResult = await extractText(pdf, { mergePages: false });
const pages = Array.isArray(textResult.text)
  ? textResult.text
  : [String(textResult.text || "")];
pages.forEach((t, i) => {
  const s = (t || "").replace(/\s+/g, " ").trim();
  console.log(`page ${i + 1} textLen=${s.length} sample=«${s.slice(0, 120)}»`);
});

// also pdfjs getTextContent item counts via page evaluate after open
await page.getByRole("button", { name: "lexxdramma_test" }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "stroitelnyy-chertezh.pdf" }).click();
await page.getByRole("button", { name: /На главную/ }).waitFor({ timeout: 30000 });
await page.waitForTimeout(2500);

const ui = await page.evaluate(() => {
  const iframe = document.querySelector("iframe[title=PDF]");
  const canvas = document.querySelector("canvas");
  return {
    iframe: !!iframe,
    canvas: !!canvas,
    regions: document
      .querySelector("[data-sync-regions]")
      ?.getAttribute("data-sync-regions"),
    loadingText: [...document.querySelectorAll("div")]
      .map((d) => d.textContent?.trim())
      .includes("Страница загружается…"),
  };
});
console.log("ui", ui);
await page.screenshot({ path: "logs/prod-debug3.png" });
await browser.close();
