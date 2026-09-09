/**
 * Smoke на prod после UI-правок 27.08.2026.
 */
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const ENGINEER = {
  login: process.env.PTO_LOGIN || "qa_engineer",
  password: process.env.PTO_PASSWORD || "QaTest-2026!",
};
const ADMIN = {
  login: process.env.PTO_ADMIN_LOGIN || "admin",
  password: process.env.PTO_ADMIN_PASSWORD || "admin123",
};

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function skip(name, detail = "") {
  checks.push({ name, pass: true, detail: `SKIP: ${detail}`, skipped: true });
  console.log(`SKIP ${name}${detail ? ` — ${detail}` : ""}`);
}

async function login(context, creds) {
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: creds,
  });
  return res.ok();
}

async function listDoneDocs(context) {
  const projectsRes = await context.request.get(`${BASE}/api/projects`);
  const { projects = [] } = await projectsRes.json();
  const docs = [];
  for (const project of projects) {
    const docsRes = await context.request.get(
      `${BASE}/api/documents?projectId=${encodeURIComponent(project.id)}&lite=1`,
    );
    const { documents = [] } = await docsRes.json();
    for (const doc of documents) {
      if (doc.status === "done") docs.push({ ...doc, projectName: project.name });
    }
  }
  return docs;
}

function pickDocs(docs) {
  const withDrawing =
    docs.find((d) => (d.kindCounts?.drawing ?? 0) > 0 && (d.kindCounts?.text ?? 0) > 0) ||
    docs.find((d) => (d.kindCounts?.drawing ?? 0) > 0);
  const withText =
    docs.find((d) => (d.kindCounts?.text ?? 0) > 0) || docs[0];
  return { withDrawing, withText };
}

async function openProject(page, projectName) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
  if ((await page.locator("[data-projects-tree]").count()) === 0) {
    const openProjects = page.getByRole("button", { name: "Открыть проект" });
    if (await openProjects.isVisible().catch(() => false)) {
      await openProjects.click();
      await page.waitForTimeout(500);
    }
  }
  const row = page
    .locator("[data-project-row]")
    .filter({ hasText: projectName })
    .locator("button")
    .first();
  if ((await row.count()) > 0) {
    await row.click();
  } else {
    await page.locator("[data-project-row] button").first().click();
  }
  await page.waitForTimeout(500);
}

async function openDocument(page, doc) {
  await openProject(page, doc.projectName);
  const escaped = doc.originalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fileBtn = page
    .locator("[data-project-files] [data-document-row]")
    .filter({ hasText: new RegExp(escaped, "i") })
    .locator("button")
    .first();
  await fileBtn.waitFor({ timeout: 20000 });
  await fileBtn.click();
  await page.getByRole("button", { name: /На главную/ }).waitFor({ timeout: 30000 });
  await page.waitForSelector(".markdown-body, textarea", { timeout: 30000 });
  return doc.originalName;
}

async function goToTextSheet(page, doc) {
  if ((doc.kindCounts?.text ?? 0) === 0) return;
  for (let i = 0; i < Math.min(doc.pageCount || 12, 20); i += 1) {
    const onText = await page.evaluate(() => {
      const tab = [...document.querySelectorAll('button[role="tab"]')].find((el) =>
        /Расшифровка|Таблица/.test(el.textContent || ""),
      );
      return tab?.getAttribute("aria-selected") === "true";
    });
    if (onText) return;
    await page.keyboard.press("j");
    await page.waitForTimeout(350);
  }
  const textTab = page.getByRole("tab", { name: /Расшифровка|Таблица/ });
  if (await textTab.isVisible().catch(() => false)) {
    await textTab.click();
    await page.waitForTimeout(300);
  }
}

async function menuText(page) {
  await page.locator('button[title="Ещё"]').click();
  await page.waitForTimeout(300);
  const text = await page.locator('[role="menu"]').innerText().catch(() => "");
  await page.locator(".flex.h-12").click({ position: { x: 120, y: 24 } });
  await page.waitForTimeout(200);
  return text;
}

const browser = await chromium.launch({ headless: true });
try {
  const engineerCtx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1366, height: 768 },
  });
  check("engineer login", await login(engineerCtx, ENGINEER));

  const doneDocs = await listDoneDocs(engineerCtx);
  check("есть готовые файлы", doneDocs.length > 0, `count=${doneDocs.length}`);
  const { withDrawing, withText } = pickDocs(doneDocs);
  if (!withDrawing && !withText) throw new Error("нет подходящих документов");

  // --- drawing + header + menu ---
  if (withDrawing) {
    const page = await engineerCtx.newPage();
    const opened = await openDocument(page, withDrawing);
    check("открыт файл с чертежом", Boolean(opened), opened);

    const header = await page.locator(".flex.h-12").first().innerText();
    check("engineer: нет chip Конвейер", !/Конвейер:/i.test(header), header.slice(0, 80));
    check("шапка: имя + лист", /·\s*лист\s+\d+\s+из\s+\d+/i.test(header));

    await page
      .waitForFunction(
        () => {
          const tab = [...document.querySelectorAll('button[role="tab"]')].find((el) =>
            el.textContent?.includes("По ширине"),
          );
          return tab?.getAttribute("aria-selected") === "true";
        },
        null,
        { timeout: 60000 },
      )
      .catch(() => {});
    const fitOk = await page.evaluate(() => {
      const tab = [...document.querySelectorAll('button[role="tab"]')].find((el) =>
        el.textContent?.includes("По ширине"),
      );
      return tab?.getAttribute("aria-selected") === "true";
    });
    check("чертёж: fit «По ширине» активен", fitOk, fitOk ? "" : "не выбран");

    const menu = await menuText(page);
    check("меню: нет Синхронный скролл", !/Синхронный скролл/i.test(menu));
    check("меню: нет Подсветка", !/Подсветка/i.test(menu));
    check(
      "справка: Ctrl + колёсико",
      /Ctrl.*кол/i.test(menu) || /колёсико/i.test(menu),
    );

    await page.close();
  }

  // --- текст расшифровки только на чтение ---
  if (withText) {
    const page = await engineerCtx.newPage();
    await openDocument(page, withText);
    await goToTextSheet(page, withText);

    check(
      "расшифровка: правка убрана",
      (await page.locator('button[title="Исправить расшифровку"]').count()) === 0,
    );
    check(
      "расшифровка: markdown на чтение",
      (await page.locator(".markdown-body").count()) > 0,
    );
    check(
      "расшифровка: подсказка про «Ошибка»",
      /Правки — через/.test(await page.locator("body").innerText()),
    );
    await page.close();
  }

  await engineerCtx.close();

  // --- admin: pipeline chip visible ---
  const adminCtx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1366, height: 768 },
  });
  const adminOk = await login(adminCtx, ADMIN);
  if (adminOk) {
    const page = await adminCtx.newPage();
    const docs = await listDoneDocs(adminCtx);
    const doc = pickDocs(docs).withDrawing || docs[0];
    if (doc) {
      await openDocument(page, doc);
      const pageText = await page.locator("body").innerText();
      check("admin: chip Конвейер", /Конвейер:/i.test(pageText));
    }
    await page.close();
  } else if (process.env.PTO_ADMIN_PASSWORD) {
    check("admin login", false, "неверный пароль");
  } else {
    skip("admin: chip Конвейер", "нет PTO_ADMIN_PASSWORD на prod");
  }
  await adminCtx.close();

  const failed = checks.filter((c) => !c.pass);
  const ok = failed.length === 0;
  console.log("\n" + (ok ? "ALL PASS" : "HAS FAILURES"));
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error("ERROR", err);
  process.exit(1);
} finally {
  await browser.close();
}
