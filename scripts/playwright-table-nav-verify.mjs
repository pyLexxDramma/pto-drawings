/**
 * Проверка: таблицы markdown + расшифровка после wrap last→first (DWG/PDF).
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

const results = { base: BASE, ok: false, checks: [] };
function check(name, pass, detail = "") {
  results.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function login(context) {
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: { login: LOGIN, password: PASSWORD },
  });
  check("login", res.ok(), String(res.status()));
  if (!res.ok()) throw new Error("login failed");
}

async function openProjectTree(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 });
  await page.getByRole("button", { name: "Открыть проект" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /lexxdramma_test/i }).first().click();
  await page.waitForTimeout(600);
}

async function listProjectDocs(context, projectName = "lexxdramma_test") {
  const projectsRes = await context.request.get(`${BASE}/api/projects`);
  const { projects = [] } = await projectsRes.json();
  const project = projects.find((p) => p.name.toLowerCase().includes(projectName.toLowerCase()));
  if (!project) return [];
  const docsRes = await context.request.get(
    `${BASE}/api/documents?projectId=${encodeURIComponent(project.id)}&lite=1`,
  );
  const { documents = [] } = await docsRes.json();
  return documents;
}

async function openDoc(page, namePattern) {
  const btn = page.getByRole("button", { name: namePattern }).first();
  await btn.waitFor({ state: "visible", timeout: 15000 });
  await btn.click();
  await page.getByRole("button", { name: /На главную/ }).waitFor({ timeout: 30000 });
}

async function waitMarkdown(page) {
  await page.waitForSelector(".markdown-body", { timeout: 30000 });
  await page.waitForFunction(
    () => {
      const body = document.querySelector(".markdown-body");
      return body && (body.innerText || "").trim().length > 20;
    },
    null,
    { timeout: 45000 },
  );
}

async function markdownLen(page) {
  return page.evaluate(() => {
    const body = document.querySelector(".markdown-body");
    return (body?.innerText || "").trim().length;
  });
}

async function currentPageLabel(page) {
  return page.evaluate(() => {
    const open = document.querySelector('[role="menu"] button[aria-pressed="true"]');
    if (open) return open.textContent?.trim() || "";
    const strip = document.querySelector('[data-page-strip] [aria-current="page"]');
    return strip?.textContent?.trim() || "";
  });
}

async function goLastPage(page) {
  for (let i = 0; i < 80; i += 1) {
    await page.keyboard.press("j");
    await page.waitForTimeout(180);
  }
}

async function wrapToFirst(page) {
  await page.keyboard.press("j");
  await page.waitForTimeout(500);
}

fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

try {
  await login(context);
  const docs = await listProjectDocs(context);
  check("документы проекта", docs.length > 0, `count=${docs.length}`);

  const tableDoc =
    docs.find((d) => (d.kindCounts?.table ?? 0) > 0 && d.status === "done") ||
    docs.find((d) => d.status === "done");
  const navDoc =
    docs.find((d) => /stroitelnyy/i.test(d.originalName) && d.pageCount > 1 && d.status === "done") ||
    docs.find((d) => d.pageCount > 1 && d.status === "done");

  await openProjectTree(page);

  // --- tables ---
  if (tableDoc) {
    const name = tableDoc.originalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await openDoc(page, new RegExp(name, "i"));
    await waitMarkdown(page);

    const tableTab = page.getByRole("tab", { name: /Таблицы/i });
    if (await tableTab.isVisible().catch(() => false)) {
      await tableTab.click();
      await page.waitForTimeout(400);
    }

    for (let n = 0; n < Math.min(tableDoc.pageCount || 5, 12); n += 1) {
      const hasTable = await page.evaluate(() => {
        const t = document.querySelector(".markdown-body table");
        if (t) return true;
        const rows = document.querySelectorAll(".markdown-body tr");
        return rows.length >= 2;
      });
      if (hasTable) break;
      await page.keyboard.press("j");
      await page.waitForTimeout(350);
    }

    const tableInfo = await page.evaluate(() => {
      const table = document.querySelector(".markdown-body table");
      const rows = document.querySelectorAll(".markdown-body tr");
      const pipeLines = [...(document.querySelector(".markdown-body")?.innerText || "").split("\n")].filter(
        (l) => l.trim().startsWith("|"),
      ).length;
      return {
        tables: document.querySelectorAll(".markdown-body table").length,
        rows: rows.length,
        pipeLines,
        sample: (document.querySelector(".markdown-body")?.innerText || "").slice(0, 120),
      };
    });
    check(
      "таблица рендерится как <table>",
      tableInfo.tables > 0 && tableInfo.rows >= 2,
      `tables=${tableInfo.tables} rows=${tableInfo.rows} pipes=${tableInfo.pipeLines}`,
    );

    if ((tableDoc.pageCount ?? 1) > 1) {
      const lenStart = await markdownLen(page);
      check("расшифровка на 1 листе (табл.)", lenStart > 20, `len=${lenStart}`);

      await goLastPage(page);
      await page.waitForTimeout(400);
      const lenLast = await markdownLen(page);
      check("расшифровка на последнем листе (табл.)", lenLast > 20, `len=${lenLast}`);

      await wrapToFirst(page);
      await page.waitForTimeout(600);
      const lenAfterWrap = await markdownLen(page);
      check(
        "расшифровка после wrap last→first",
        lenAfterWrap > 20,
        `len=${lenAfterWrap} (was ${lenStart})`,
      );

      await page.keyboard.press("j");
      await page.waitForTimeout(300);
      await page.keyboard.press("k");
      await page.waitForTimeout(300);
      const lenBack = await markdownLen(page);
      check("расшифровка после j/k", lenBack > 20, `len=${lenBack}`);
    } else if (navDoc) {
      await page.getByRole("button", { name: /На главную/ }).click();
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: "Открыть проект" }).click();
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: /lexxdramma_test/i }).first().click();
      await page.waitForTimeout(500);
      await openDoc(page, /stroitelnyy/i);
      await waitMarkdown(page);

      const lenStart = await markdownLen(page);
      check("расшифровка на 1 листе", lenStart > 20, `len=${lenStart}`);

      await goLastPage(page);
      await page.waitForTimeout(400);
      const lenLast = await markdownLen(page);
      check("расшифровка на последнем листе", lenLast > 20, `len=${lenLast}`);

      await wrapToFirst(page);
      await page.waitForTimeout(600);
      const lenAfterWrap = await markdownLen(page);
      check(
        "расшифровка после wrap last→first",
        lenAfterWrap > 20,
        `len=${lenAfterWrap} (was ${lenStart})`,
      );

      await page.keyboard.press("j");
      await page.waitForTimeout(300);
      await page.keyboard.press("k");
      await page.waitForTimeout(300);
      const lenBack = await markdownLen(page);
      check("расшифровка после j/k", lenBack > 20, `len=${lenBack}`);
    } else {
      check("расшифровка после wrap last→first", false, "нет multi-page документа");
    }

    await page.getByRole("button", { name: /На главную/ }).click();
    await page.waitForTimeout(500);
  } else {
    check("таблица рендерится как <table>", false, "нет документа с таблицами");
  }

  results.ok = results.checks.every((c) => c.pass);
} catch (err) {
  results.ok = false;
  results.error = err instanceof Error ? err.message : String(err);
  console.error("ERROR", results.error);
} finally {
  await page
    .screenshot({
      path: path.join(ROOT, "logs", "table-nav-verify.png"),
      timeout: 8000,
      animations: "disabled",
    })
    .catch(() => {});
  fs.writeFileSync(
    path.join(ROOT, "logs", "table-nav-verify.json"),
    JSON.stringify(results, null, 2),
  );
  console.log("\n" + (results.ok ? "ALL PASS" : "HAS FAILURES"));
  await browser.close();
  process.exit(results.ok ? 0 : 1);
}
