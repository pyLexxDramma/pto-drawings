/**
 * Прод: что нашёл помощник по «Северный квартал», подсветка, пометка,
 * и регресс правок (фильтры, Назад, retry, лимит 20 МБ).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const shots = join(__dirname, "..", "samples", "shots");
mkdirSync(shots, { recursive: true });

const BASE = process.env.PTO_BASE_URL || "https://201.24.50.177";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});

const report = {
  project: null,
  documents: [],
  reviews: [],
  highlight: null,
  mark: null,
};

try {
  const auth = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { login: LOGIN, password: PASSWORD },
    timeout: 60000,
  });
  check("login", auth.ok(), String(auth.status()));
  if (!auth.ok()) throw new Error("login failed");

  const { projects = [] } = await (await ctx.request.get(`${BASE}/api/projects`)).json();
  let picked = null;
  for (const project of projects) {
    const { documents = [] } = await (
      await ctx.request.get(
        `${BASE}/api/documents?projectId=${encodeURIComponent(project.id)}&lite=1`,
      )
    ).json();
    const hit = documents.find((d) => /Северн|ПЗУ|квартал/i.test(d.originalName));
    if (hit || /TestUI|Lexx/i.test(project.name)) {
      picked = { project, documents };
      if (hit) break;
    }
  }
  if (!picked) {
    for (const project of projects) {
      const { documents = [] } = await (
        await ctx.request.get(
          `${BASE}/api/documents?projectId=${encodeURIComponent(project.id)}&lite=1`,
        )
      ).json();
      if (documents.some((d) => d.status === "done")) {
        picked = { project, documents };
        break;
      }
    }
  }
  check("проект с комплектом", Boolean(picked), picked?.project.name ?? "");
  if (!picked) throw new Error("нет проекта");

  report.project = { id: picked.project.id, name: picked.project.name };
  const { documents = [] } = await (
    await ctx.request.get(
      `${BASE}/api/documents?projectId=${encodeURIComponent(picked.project.id)}`,
    )
  ).json();
  report.documents = documents.map((d) => ({
    name: d.originalName,
    status: d.status,
    pages: d.pageCount,
    kit: d.kitRole,
    error: d.errorMessage,
    annotations: (d.pages || []).reduce(
      (n, p) => n + (p.annotations?.length ?? 0),
      0,
    ),
  }));
  for (const d of report.documents) {
    console.log(
      `DOC ${d.name} status=${d.status} pages=${d.pages} kit=${d.kit ?? "-"} ann=${d.annotations}`,
    );
  }

  const { reviews = [] } = await (
    await ctx.request.get(
      `${BASE}/api/projects/${picked.project.id}/reviews`,
    )
  ).json();
  report.reviews = reviews.map((r) => ({
    number: r.number,
    origin: r.origin,
    severity: r.severity,
    verdict: r.verdict,
    section: r.section,
    text: (r.text || r.aiFinding || "").slice(0, 240),
    locations: (r.locations || []).map((l) => ({
      file: l.documentName,
      page: l.pageNumber,
      quote: (l.quote || "").slice(0, 140),
      hasRect: Boolean(l.rect),
    })),
  }));
  console.log(`REVIEWS ${reviews.length}`);
  for (const r of report.reviews) {
    console.log(
      `#${r.number} ${r.origin} ${r.severity} ${r.section}: ${r.text}`,
    );
    for (const l of r.locations) {
      console.log(
        `  → ${l.file} p.${l.page} rect=${l.hasRect} «${l.quote}»`,
      );
    }
  }
  check(
    "помощник что-то выписал",
    reviews.some((r) => r.origin === "ai" || r.origin === "both"),
    `ai=${reviews.filter((r) => r.origin === "ai" || r.origin === "both").length} engineer=${reviews.filter((r) => r.origin === "engineer").length}`,
  );

  const planted = [
    "2450",
    "2180",
    "1:100",
    "1:200",
    "12.50",
    "11.80",
    "ВСХН-20",
    "+0.150",
    "+0.250",
    "54.00",
    "51.60",
    "86",
    "72",
    "1000",
    "630",
    "Ду100",
    "Ду80",
    "38.4",
    "42.1",
    "1.20",
    "1.35",
    "250",
    "180",
  ];
  const blob = reviews
    .map((r) => `${r.text} ${r.aiFinding} ${(r.locations || []).map((l) => l.quote).join(" ")}`)
    .join("\n");
  const foundPlanted = planted.filter((p) => blob.includes(p));
  console.log(`PLANTED_HITS ${foundPlanted.length}/${planted.length}: ${foundPlanted.join(", ")}`);

  const page = await ctx.newPage();
  await page.goto(
    `${BASE}/?project=${picked.project.id}`,
    { waitUntil: "domcontentloaded", timeout: 90000 },
  );
  await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const pauseHint = await page.getByText(/Обработка сейчас выключена/i).count();
  check("пауза конвейера снята (нет плашки на загрузке)", pauseHint === 0);

  await page.getByRole("button", { name: /Таблица замечаний/ }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(shots, "prod-reviews-table.png") });

  const sevFilter = page.getByRole("button", { name: "Фильтр Важность" });
  check("фильтр Важность", (await sevFilter.count()) > 0);
  if ((await sevFilter.count()) > 0) {
    await sevFilter.click();
    await page.waitForTimeout(300);
    check(
      "Excel-меню",
      (await page.getByText("Сортировка от А до Я").count()) > 0 &&
        (await page.getByText("(Выделить все)").count()) > 0,
    );
    await page.keyboard.press("Escape");
  }
  check("кнопка скачать таблицу", (await page.getByRole("button", { name: /Скачать таблицу/ }).count()) > 0);

  const where = page.getByRole("button", { name: /Открыть в ПД|Где в ПД/ }).first();
  const whereCount = await page.locator("button", { hasText: /лист|стр/ }).count();
  const locLinks = page.locator("a, button").filter({ hasText: /лист \d+|стр\.\d+|p\.\d+/i });
  console.log(`where-btns=${await where.count()} loc-ish=${whereCount}`);

  const firstLoc = page.getByText(/«/).first();
  if ((await firstLoc.count()) > 0) {
    await firstLoc.click();
    await page.waitForTimeout(3500);
    const zones = await page.locator(".pto-remark-zone").count();
    const marks = await page.locator("mark").count();
    const notFound = await page.getByText(/цитата не найдена/i).count();
    const banner = await page.getByText(/цитата|подсвет/i).count();
    report.highlight = { zones, marks, notFound, banner };
    await page.screenshot({ path: join(shots, "prod-highlight-jump.png") });
    check(
      "подсветка после перехода из таблицы",
      zones > 0 || marks > 0,
      `zones=${zones} marks=${marks} notFound=${notFound}`,
    );
  } else {
    const rowBtn = page.locator("table button, [data-review-row] button").first();
    if ((await rowBtn.count()) > 0) {
      await rowBtn.click();
      await page.waitForTimeout(3500);
      const zones = await page.locator(".pto-remark-zone").count();
      const marks = await page.locator("mark").count();
      report.highlight = { zones, marks, via: "row" };
      await page.screenshot({ path: join(shots, "prod-highlight-jump.png") });
      check("подсветка по клику строки", zones > 0 || marks > 0, `zones=${zones} marks=${marks}`);
    } else {
      check("есть ссылка «Где в ПД»", false, "не нашёл кликабельную цитату");
    }
  }

  await page.getByRole("button", { name: /Расшифровка/ }).click().catch(() => {});
  await page.waitForTimeout(800);
  const pdfDoc = documents.find((d) => /\.pdf$/i.test(d.originalName));
  if (pdfDoc) {
    const pdfRow = page.getByText(pdfDoc.originalName, { exact: false }).first();
    if ((await pdfRow.count()) > 0) await pdfRow.click();
    await page.waitForTimeout(2500);
  }

  const searchBtn = page.getByRole("button", { name: /Поиск по файлу|Поиск/ }).first();
  if ((await searchBtn.count()) > 0) {
    await searchBtn.click();
    await page.waitForTimeout(400);
    const closeHint = page.getByRole("button", { name: "← Закрыть поиск" });
    check("Назад из поиска = Закрыть поиск", (await closeHint.count()) > 0);
    if ((await closeHint.count()) > 0) await closeHint.click();
  } else {
    check("кнопка Поиск на листе", false);
  }

  const markBtn = page.getByRole("button", { name: /Отметить ошибку/ }).first();
  check("кнопка Отметить ошибку", (await markBtn.count()) > 0);
  if ((await markBtn.count()) > 0) {
    await markBtn.click();
    await page.waitForTimeout(400);
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.4);
      await page.waitForTimeout(400);
      await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.55);
      await page.waitForTimeout(800);
      const dialog = page.getByPlaceholder(/комментар|замечан|ожида/i).first();
      const comment = page.locator("textarea").first();
      if ((await comment.count()) > 0) {
        await comment.fill("Проверка пометки Playwright: площадь 2450 против 2180");
      }
      const save = page.getByRole("button", { name: /Сохранить|Добавить|Отметить/ }).last();
      if ((await save.count()) > 0) await save.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(shots, "prod-mark-error.png") });
    }
    const { reviews: afterMark = [] } = await (
      await ctx.request.get(
        `${BASE}/api/projects/${picked.project.id}/reviews`,
      )
    ).json();
    const engineer = afterMark.filter((r) => r.origin === "engineer" || r.origin === "both");
    const anns = (await (
      await ctx.request.get(
        `${BASE}/api/documents?projectId=${encodeURIComponent(picked.project.id)}`,
      )
    ).json()).documents?.flatMap((d) =>
      (d.pages || []).flatMap((p) => p.annotations || []),
    );
    report.mark = {
      reviewsNow: afterMark.length,
      engineer: engineer.length,
      annotations: anns?.length ?? 0,
      lastEngineer: engineer.at(-1)
        ? {
            id: engineer.at(-1).id,
            text: (engineer.at(-1).text || "").slice(0, 120),
            reviewIdOnAnn: anns?.find((a) => a.reviewId === engineer.at(-1).id)?.id ?? null,
          }
        : null,
    };
    console.log("MARK", JSON.stringify(report.mark));
    check(
      "пометка попала в таблицу",
      afterMark.length > reviews.length || engineer.length > 0,
      `reviews ${reviews.length}→${afterMark.length} engineer=${engineer.length} ann=${anns?.length ?? 0}`,
    );

    const linked = engineer.at(-1);
    if (linked) {
      const del = await ctx.request.delete(
        `${BASE}/api/projects/${picked.project.id}/reviews/${linked.id}`,
      );
      check("удаление замечания API", del.ok(), String(del.status()));
      const afterDel = await (
        await ctx.request.get(
          `${BASE}/api/documents?projectId=${encodeURIComponent(picked.project.id)}`,
        )
      ).json();
      const left = (afterDel.documents || []).flatMap((d) =>
        (d.pages || []).flatMap((p) => p.annotations || []),
      );
      const orphan = left.some((a) => a.reviewId === linked.id);
      check("удаление из таблицы сняло пометку с листа", !orphan, `ann left=${left.length}`);
    }
  }

  const retry = page.getByRole("button", { name: "Запустить заново" });
  const failed = page.getByText("не обработан", { exact: false });
  check(
    "retry рядом с упавшими",
    (await failed.count()) === 0 || (await retry.count()) > 0,
    `failed=${await failed.count()} retry=${await retry.count()}`,
  );

  await page.screenshot({ path: join(shots, "prod-session-end.png") });
} catch (err) {
  check("smoke", false, err instanceof Error ? err.message : String(err));
  console.error(err);
} finally {
  writeFileSync(
    join(shots, "prod-session-report.json"),
    JSON.stringify({ report, checks }, null, 2),
    "utf8",
  );
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(failed.length ? `FAILED ${failed.length}` : "ALL_OK");
process.exit(failed.length ? 1 : 0);
