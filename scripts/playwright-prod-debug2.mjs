import { chromium } from "playwright";
import fs from "fs";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
const fails = [];
const reqs = [];
page.on("requestfailed", (r) =>
  fails.push(`${r.url()} ${r.failure()?.errorText || ""}`),
);
page.on("response", (r) => {
  if (r.url().includes("/file") || r.url().includes("pdf.worker")) {
    reqs.push(`${r.status()} ${r.url()} ct=${r.headers()["content-type"]}`);
  }
});
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") {
    console.log(`[console.${m.type()}]`, m.text());
  }
});

await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 });
await page.getByRole("button", { name: "lexxdramma_test" }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "stroitelnyy-chertezh.pdf" }).click();
await page.getByRole("button", { name: /На главную/ }).waitFor({ timeout: 30000 });

// wait and poll for canvas
for (let i = 0; i < 20; i++) {
  const state = await page.evaluate(() => ({
    canvas: !!document.querySelector("canvas"),
    regions: document.querySelector("[data-sync-regions]")?.getAttribute("data-sync-regions"),
    loading: [...document.querySelectorAll("*")]
      .some((el) => (el.textContent || "").trim() === "Загрузка…" && el.children.length === 0),
    pdfErr: [...document.querySelectorAll("*")].some(
      (el) => (el.textContent || "").trim() === "Не удалось показать страницу",
    ),
  }));
  console.log(`t=${i * 1}s`, state);
  if (state.canvas && Number(state.regions) > 0) break;
  await page.waitForTimeout(1000);
}

const fileProbe = await page.evaluate(async () => {
  const html = document.documentElement.innerHTML;
  const idMatch = html.match(/\/api\/documents\/([a-f0-9-]{36})\//);
  const id = idMatch?.[1] || null;
  let fetchResult = null;
  if (id) {
    try {
      const r = await fetch(`/api/documents/${id}/file`, { credentials: "include" });
      const buf = await r.arrayBuffer();
      fetchResult = {
        status: r.status,
        type: r.headers.get("content-type"),
        len: buf.byteLength,
        magic: String.fromCharCode(...new Uint8Array(buf.slice(0, 5))),
      };
    } catch (e) {
      fetchResult = { error: String(e) };
    }
  }
  return { id, fetchResult };
});
console.log("fileProbe", JSON.stringify(fileProbe, null, 2));
console.log("file responses", reqs);
console.log("fails", fails);

// switch sheets
await page.locator("text=/лист\\s+\\d+\\s+из\\s+\\d+/i").first().click();
await page.waitForTimeout(400);
const labels = await page.evaluate(() =>
  [...document.querySelectorAll("[role=menuitem],button,a")]
    .map((e) => (e.textContent || "").trim().replace(/\s+/g, " "))
    .filter((t) => /лист|Лист|\d+\s*·/i.test(t))
    .slice(0, 30),
);
console.log("sheet labels", labels);

fs.mkdirSync("logs", { recursive: true });
await page.screenshot({ path: "logs/prod-debug2.png" });
await browser.close();
