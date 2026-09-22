import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://201.24.50.177";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});

try {
  const auth = await context.request.post(`${BASE}/api/auth/login`, {
    data: { login: LOGIN, password: PASSWORD },
  });
  check("login", auth.ok(), String(auth.status()));
  if (!auth.ok()) throw new Error("login failed");

  const projectsRes = await context.request.get(`${BASE}/api/projects`);
  const { projects = [] } = await projectsRes.json();
  let withFiles = null;
  for (const project of projects) {
    const docsRes = await context.request.get(
      `${BASE}/api/documents?projectId=${encodeURIComponent(project.id)}&lite=1`,
    );
    const { documents = [] } = await docsRes.json();
    if (documents.length > 0) {
      withFiles = { project, documents };
      break;
    }
  }
  check(
    "есть проект с файлами",
    Boolean(withFiles),
    withFiles ? `${withFiles.project.name} · ${withFiles.documents.length}` : "пусто",
  );

  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});

  const openBtn = page.getByRole("button", { name: "Открыть проект" });
  if (await openBtn.isVisible().catch(() => false)) await openBtn.click();

  await page.locator("[data-project-row]").first().waitFor({ timeout: 20000 });
  const stagesVisible = (await page.getByRole("button", { name: /Расшифровка/ }).count()) > 0;
  if (!stagesVisible) {
    await page.locator("[data-project-row] button").first().click();
    await page.waitForTimeout(800);
  }

  const failedBadge = page.getByText("не обработан", { exact: false });
  const retryBtn = page.getByRole("button", { name: "Запустить заново" });
  const failedCount = await failedBadge.count();
  const retryCount = await retryBtn.count();
  check(
    "статус+retry на упавших файлах",
    failedCount === 0 || retryCount > 0,
    `failed=${failedCount} retry=${retryCount}`,
  );

  await page.getByRole("button", { name: /Таблица замечаний/ }).click();
  await page.waitForTimeout(800);
  const sevFilter = page.getByRole("button", { name: "Фильтр Важность" });
  const verdFilter = page.getByRole("button", { name: "Фильтр Статус" });
  check("фильтр важности в шапке", (await sevFilter.count()) > 0);
  check("фильтр статуса в шапке", (await verdFilter.count()) > 0);
  if ((await sevFilter.count()) > 0) {
    await sevFilter.click();
    await page.waitForTimeout(300);
    check(
      "меню как в Excel",
      (await page.getByText("Сортировка от А до Я").count()) > 0 &&
        (await page.getByText("(Выделить все)").count()) > 0,
    );
    await page.keyboard.press("Escape");
  }

  const xlsx = page.getByRole("button", { name: /Скачать таблицу/ });
  check("кнопка выгрузки таблицы", (await xlsx.count()) > 0);

  await page.getByRole("button", { name: /Расшифровка/ }).click();
  await page.waitForTimeout(1500);
  let searchBtn = page.getByRole("button", { name: /Поиск по файлу|Поиск/ }).first();
  if ((await searchBtn.count()) === 0) {
    const docRow = page.locator("[data-document-row] button").first();
    if ((await docRow.count()) > 0) {
      await docRow.click();
      await page.waitForTimeout(1500);
      searchBtn = page.getByRole("button", { name: /Поиск по файлу|Поиск/ }).first();
    }
  }
  if ((await searchBtn.count()) > 0) {
    await searchBtn.click();
    await page.waitForTimeout(400);
    const closeHint = page.getByRole("button", { name: "← Закрыть поиск" });
    check("Назад из поиска = Закрыть поиск", (await closeHint.count()) > 0);
    if ((await closeHint.count()) > 0) {
      await closeHint.click();
      await page.waitForTimeout(300);
      check(
        "после Закрыть поиск лист на месте",
        (await page.getByRole("button", { name: /Поиск/ }).count()) > 0,
      );
    }
  } else {
    console.log("SKIP поиск на листе — кнопки Поиск нет");
  }
} catch (err) {
  check("smoke", false, err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
}

const failed = checks.filter((item) => !item.pass);
console.log(failed.length ? `FAILED ${failed.length}` : "ALL_OK");
process.exit(failed.length ? 1 : 0);
