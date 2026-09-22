/**
 * Есть ли у листа текстовый слой и цепляется ли подсветка.
 * Берём фразы из расшифровки самого листа и прыгаем на них через &quote=.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const shots = join(dirname(fileURLToPath(import.meta.url)), "..", "samples", "shots");
const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const DOC = process.env.PTO_DOC;
const PROJECT = process.env.PTO_PROJECT_ID;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 950 } });
await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: process.env.PTO_LOGIN, password: process.env.PTO_PASSWORD },
  timeout: 60000,
});

const detail = await (await ctx.request.get(`${BASE}/api/documents/${DOC}`)).json();
const doc = detail.document;
const page1 = (doc?.pages ?? [])[0];
const md = page1?.markdown ?? "";
console.log(`файл: ${doc?.originalName}`);
console.log(`лист: kind=${page1?.kind} source=${page1?.source} markdown ${md.length} симв.`);
console.log("числа-подозрения:", (page1?.numbers?.suspect ?? []).slice(0, 12));
console.log("--- расшифровка (первые 1200) ---");
console.log(md.slice(0, 1200));

// Только раздел «дословно»: описание модели на листе не напечатано.
const literalStart = md.search(/из чертежа, дословно|дословно\)/i);
const literal = literalStart >= 0 ? md.slice(literalStart) : md;
const lines = literal
  .split("\n")
  .map((s) => s.replace(/[*_`|#>]/g, " ").trim())
  .filter((s) => s.length > 8 && !/^-+$/.test(s) && !/^лист \d/i.test(s));
const candidates = [...new Set(lines)];
const probes = (process.env.PTO_QUOTES
  ? process.env.PTO_QUOTES.split(";;")
  : candidates.slice(0, 6)
).map((s) => (s.length > 60 ? s.slice(0, 60).replace(/\s+\S*$/, "") : s));
console.log("--- дословный текст листа (первые 900) ---");
console.log(literal.slice(0, 900));
console.log("\nпробуем цитаты:", probes);

const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`);
});

let index = 0;
for (const quote of probes) {
  index += 1;
  const url = `${BASE}/?project=${PROJECT}&doc=${DOC}&page=1&from=reviews&quote=${encodeURIComponent(quote)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(7000);
  const info = await page.evaluate(() => {
    const t = document.body.innerText;
    const found = t.match(/найдено:\s*(\d+)/i);
    return {
      foundCount: found ? Number(found[1]) : null,
      quoteMiss: /цитата не найдена/i.test(t),
      noLayer: /нет текстового слоя/i.test(t),
      zones: document.querySelectorAll(".pto-remark-zone").length,
      marks: document.querySelectorAll("mark").length,
    };
  });
  console.log(`\n«${quote.slice(0, 50)}» →`, JSON.stringify(info));
  await page.screenshot({ path: join(shots, `prod-ios4-${index}.png`) });
}

// Поиск по листу Ctrl+F — прямая проверка текстового слоя.
await page.goto(`${BASE}/?project=${PROJECT}&doc=${DOC}&page=1`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.waitForTimeout(6000);
await page.screenshot({ path: join(shots, "prod-ios4-sheet.png"), fullPage: false });
console.log("\nCONSOLE", logs.slice(0, 8));
await browser.close();
