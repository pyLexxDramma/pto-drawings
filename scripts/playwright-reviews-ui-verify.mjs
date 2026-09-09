/**
 * Локальная проверка UI разбора замечаний: полоса этапов, «Неверно» с причиной,
 * явное сохранение комментария, лист поверх таблицы с возвратом в строку.
 */
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "http://localhost:3000";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";
const PROJECT = process.env.PTO_PROJECT || "Жуковский 1 — демо (ПТО)";

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
/** На проде замечаний может не быть — такие проверки честно помечаем. */
function skip(name, why) {
  console.log(`SKIP ${name} — ${why}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

const auth = await context.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});
check("login", auth.ok(), String(auth.status()));
if (!auth.ok()) {
  await browser.close();
  process.exit(1);
}

// Автора правки сверяем с тем, кем вошли: на проде это не «Админ».
const me = await (await context.request.get(`${BASE}/api/auth/me`)).json();
const myName = me?.user?.displayName || me?.user?.login || LOGIN;

const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 });
await page.getByRole("button", { name: "Открыть проект" }).click();
await page.waitForTimeout(600);
const projectRows = page.locator("[data-project-row]");
await projectRows.first().waitFor({ timeout: 20000 }).catch(() => undefined);
const wanted = projectRows.filter({ hasText: PROJECT.slice(0, 9) }).first();
if (await wanted.count()) {
  await wanted.locator("button").first().click();
} else {
  // На проде демо-проекта нет — берём первый в списке.
  await projectRows.first().locator("button").first().click();
}
await page.waitForTimeout(1200);

// --- полоса этапов ---
const COUNT = String.raw`(\d+\/\d+|—)`;
const transcribeStage = page.getByRole("button", {
  name: new RegExp(`^Расшифровка ${COUNT}$`),
});
await transcribeStage.waitFor({ timeout: 20000 });
// В раскрытом виде метка и счётчик — разные строки, поэтому склеиваем пробелы.
const barText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
check("этапы: нет «Обработка»", !new RegExp(`Обработка ${COUNT}`).test(barText));
check(
  "этапы: Расшифровка и Замечания",
  new RegExp(`Расшифровка ${COUNT}`).test(barText) &&
    new RegExp(`Замечания ${COUNT}`).test(barText),
);
check(
  "этапы: открыты по умолчанию",
  (await page.getByRole("button", { name: "Свернуть ▴" }).count()) === 1 &&
    (await page.getByRole("button", { name: "Прогресс ▾" }).count()) === 0,
);
// Свернуть → развернуть: навигация по этапам должна жить в обоих видах.
await page.getByRole("button", { name: "Свернуть ▴" }).click();
check(
  "этапы: сворачиваются кнопкой",
  (await page.getByRole("button", { name: "Прогресс ▾" }).count()) === 1,
);
await page.getByRole("button", { name: "Прогресс ▾" }).click();
await page.getByRole("button", { name: "Свернуть ▴" }).waitFor({ timeout: 10000 });

// --- переход в таблицу из полосы этапов ---
await page
  .getByRole("button", { name: new RegExp(`^Замечания ${COUNT}$`) })
  .click();
await page.getByRole("button", { name: /К чертежам/ }).waitFor({ timeout: 20000 });
check("таблица открылась из этапа", true);

const rows = page.locator("tbody tr").filter({ has: page.locator("select") });
await rows.first().waitFor({ timeout: 20000 }).catch(() => undefined);
const rowCount = await rows.count();
// Прод до публикации конвейера пустой — тогда проверяем только каркас.
const EMPTY = "в проекте нет замечаний";
if (rowCount === 0) {
  check(
    "таблица: пустое состояние объяснено",
    /конвейер их ещё не присылал/.test(await page.locator("table, div").last().innerText().catch(() => "")) ||
      /конвейер их ещё не присылал/.test(await page.locator("body").innerText()),
  );
  for (const name of [
    "«Неверно»: окно причины",
    "комментарий: явное сохранение",
    "журнал правок строки",
    "лист поверх таблицы",
  ]) {
    skip(name, EMPTY);
  }
  await browser.close();
  const failedEarly = checks.filter((item) => !item.pass);
  console.log(`\n${checks.length - failedEarly.length}/${checks.length} проверок прошло`);
  process.exit(failedEarly.length ? 1 : 0);
}
check("таблица: строки есть", rowCount > 0, `${rowCount}`);

// --- «Неверно» требует причину (берём неразобранную строку) ---
let target = await rows.first().getAttribute("data-review-id");
for (let index = 0; index < rowCount; index += 1) {
  const candidate = rows.nth(index);
  if ((await candidate.locator("select").nth(1).inputValue()) === "pending") {
    target = await candidate.getAttribute("data-review-id");
    break;
  }
}
// От правок строка меняет порядок в таблице, поэтому держимся за id, не за индекс.
const first = page.locator(`tbody tr[data-review-id="${target}"]`);
await first.locator("select").nth(1).selectOption("wrong");
const dialog = page.getByRole("dialog", { name: "Что неверно в замечании" });
await dialog.waitFor({ timeout: 10000 });
check("«Неверно»: окно причины", true);
await dialog.locator("textarea").fill("");
check(
  "«Неверно»: без причины не сохранить",
  await dialog.getByRole("button", { name: "Сохранить" }).isDisabled(),
);
await dialog.getByRole("button", { name: "Такого в чертеже нет" }).click();
await dialog.getByRole("button", { name: "Сохранить" }).click();
await dialog.waitFor({ state: "hidden", timeout: 15000 });
await page.waitForTimeout(600);
check(
  "«Неверно»: причина в строке",
  /Неверно: Такого в чертеже нет/.test(await first.innerText()),
);
const tableHeader = page.locator("header").filter({ hasText: "Замечания ·" });
check(
  "«Неверно»: счётчик брака в шапке",
  /брак ИИ \d+/.test(await tableHeader.innerText()),
);

// --- комментарий сохраняется только по кнопке ---
const commentBox = first.locator("textarea");
await commentBox.fill(`проверить с ОВ на разборе ${Date.now()}`);
check(
  "комментарий: кнопка сохранения появилась",
  (await first.getByRole("button", { name: "Сохранить" }).count()) === 1,
);
await first.getByRole("button", { name: "Сохранить" }).click();
await page.waitForTimeout(800);
check(
  "комментарий: отметка «Сохранено»",
  /Сохранено/.test(await first.innerText()),
);

// --- журнал строки ---
await page.waitForTimeout(1200);
const logButton = first.locator('button[title="Журнал правок этого замечания"]');
if (await logButton.count()) {
  await logButton.click();
  const log = page.getByRole("dialog", { name: "Журнал разбора замечания" });
  await log.waitFor({ timeout: 10000 });
  const logText = await log.innerText();
  check("журнал: разбор и комментарий", /Разбор/.test(logText) && /Комментарий/.test(logText));
  check("журнал: указан автор", logText.includes(myName), myName);
  await log.getByRole("button", { name: "Закрыть" }).click();
} else {
  check("журнал: подпись правки в строке", false, "кнопка журнала не найдена");
}

// --- лист поверх таблицы и возврат в строку ---
const placeLink = page
  .locator("tbody button")
  .filter({ hasText: /стр\. \d+/ })
  .first();
if (await placeLink.count()) {
  await placeLink.click();
  await page.getByRole("button", { name: /К таблице замечаний/ }).waitFor({ timeout: 30000 });
  check("лист открылся поверх таблицы", true);
  check(
    "лист: правка текста убрана",
    (await page.locator('button[title="Исправить расшифровку"]').count()) === 0,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /К чертежам/ }).waitFor({ timeout: 20000 });
  check("Esc вернул в таблицу", true);
} else {
  check("лист поверх таблицы", false, "нет ссылки на место в ПД");
}

await browser.close();

const failed = checks.filter((item) => !item.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} проверок прошло`);
process.exit(failed.length ? 1 : 0);
