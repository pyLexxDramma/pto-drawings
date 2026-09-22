/** Полная расшифровка листа + строки текстового слоя самого PDF. */
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const DOC = process.env.PTO_DOC;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: process.env.PTO_LOGIN, password: process.env.PTO_PASSWORD },
  timeout: 60000,
});

const detail = await (await ctx.request.get(`${BASE}/api/documents/${DOC}`)).json();
const md = (detail.document?.pages ?? [])[0]?.markdown ?? "";
console.log("=== ЗАГОЛОВКИ РАСШИФРОВКИ ===");
for (const line of md.split("\n")) {
  if (/^#{1,4}\s/.test(line) || /^\*\*.+\*\*$/.test(line.trim())) console.log(line.trim());
}
console.log(`\n=== РАСШИФРОВКА, хвост 3000 ===`);
console.log(md.slice(-3000));

// Текстовый слой самого PDF глазами pdf.js — то же, что ищет подсветка.
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
const layer = await page.evaluate(async (docId) => {
  const pdfjs = await import("/pdf.worker.min.mjs").catch(() => null);
  void pdfjs;
  const res = await fetch(`/api/documents/${docId}/file`, { credentials: "include" });
  const buf = new Uint8Array(await res.arrayBuffer());
  const lib = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs");
  lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const pdf = await lib.getDocument({ data: buf }).promise;
  const p = await pdf.getPage(1);
  const content = await p.getTextContent();
  const items = content.items.map((i) => (i.str || "").trim()).filter((s) => s.length > 1);
  return { count: items.length, sample: items.slice(0, 80) };
}, DOC);
console.log("\n=== ТЕКСТОВЫЙ СЛОЙ PDF ===");
console.log("фрагментов:", layer.count);
console.log(layer.sample.join(" | "));
await browser.close();
