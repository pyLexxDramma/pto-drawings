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

const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 });
await page.getByRole("button", { name: "Открыть проект" }).click();
await page.getByRole("button", { name: new RegExp(PROJECT.slice(0, 12)) }).first().click();
await page.waitForTimeout(1200);

// --- полоса этапов ---
const transcribeStage = page.getByRole("button", { name: /^Расшифровка \d+\/\d+$/ });
await transcribeStage.waitFor({ timeout: 20000 });
const barText = await page.locator("body").innerText();
check("этапы: нет «Обработка»", !/Обработка \d+\/\d+/.test(barText));
check("этапы: Расшифровка и Замечания", /Расшифровка \d+\/\d+/.test(barText) && /Замечания \d+\/\d+/.test(barText));
check(
  "этапы: свёрнуты по умолчанию",
  (await page.getByRole("button", { name: "Прогресс ▾" }).count()) === 1,
);

// --- переход в таблицу из свёрнутой полосы ---
await page.getByRole("button", { name: /^Замечания \d+\/\d+$/ }).click();
await page.getByRole("button", { name: /К чертежам/ }).waitFor({ timeout: 20000 });
check("таблица открылась из этапа", true);

const rows = page.locator("tbody tr").filter({ has: page.locator("select") });
await rows.first().waitFor({ timeout: 20000 });
const rowCount = await rows.count();
check("таблица: строки есть", rowCount > 0, `${rowCount}`);

// --- «Неверно» требует причину (берём неразобранную строку) ---
let first = rows.first();
for (let index = 0; index < rowCount; index += 1) {
  const candidate = rows.nth(index);
  if ((await candidate.locator("select").nth(1).inputValue()) === "pending") {
    first = candidate;
    break;
  }
}
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
  /Неверно: Такого в чертеже нет/.test(await page.locator("tbody").innerText()),
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
  check("журнал: указан автор", /Админ/.test(logText));
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
