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
const openBtn = page.getByRole("button", { name: "Открыть проект" });
if (await openBtn.count()) await openBtn.click().catch(() => undefined);
await page.waitForTimeout(600);
const projectRows = page.locator("[data-project-row]");
await projectRows.first().waitFor({ timeout: 20000 }).catch(() => undefined);
// Первый проект уже открыт при загрузке — повторный клик его свернёт.
const stagesVisible = await page
  .getByRole("button", { name: /Расшифровка/ })
  .count();
if (stagesVisible === 0) {
  const wanted = projectRows.filter({ hasText: PROJECT.slice(0, 9) }).first();
  if (await wanted.count()) {
    await wanted.locator("button").first().click();
  } else {
    await projectRows.first().locator("button").first().click();
  }
  await page.waitForTimeout(1200);
}

// --- полоса этапов ---
// Завершённый этап дописывает к счётчику галочку — она в имя кнопки тоже входит.
const COUNT = String.raw`(\d+\/\d+|ещё нет|нет файлов|режем на листы)( ✓)?`;
const transcribeStage = page.getByRole("button", {
  name: new RegExp(`^Расшифровка ${COUNT}$`),
});
await transcribeStage.waitFor({ timeout: 20000 });
// В раскрытом виде метка и счётчик — разные строки, поэтому склеиваем пробелы.
const barText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
check("этапы: нет «Обработка»", !new RegExp(`Обработка ${COUNT}`).test(barText));
check(
  "этапы: Расшифровка и Таблица замечаний",
  new RegExp(`Расшифровка ${COUNT}`).test(barText) &&
    new RegExp(`Таблица замечаний ${COUNT}`).test(barText),
);
// Кнопки «Свернуть ▴ / Прогресс ▾» в полосе этапов больше нет — этапы всегда на
// виду, поэтому проверяем только то, что оба таба кликабельны.
check("этапы: таб расшифровки доступен", await transcribeStage.isEnabled());

// --- переход в таблицу из полосы этапов ---
await page
  .getByRole("button", { name: new RegExp(`^Таблица замечаний ${COUNT}$`) })
  .click();
await page.getByRole("button", { name: /К проектам/ }).waitFor({ timeout: 20000 });
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
  /брак \d+/.test(await tableHeader.innerText()),
);

// --- комментарий сохраняется только по кнопке ---
// Поле заметки свёрнуто в кнопку, пока его не открыли, — иначе в таблице было
// пятнадцать пустых textarea подряд.
const commentToggle = first.getByRole("button", { name: /заметка/ });
if (await commentToggle.count()) await commentToggle.first().click();
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

// --- лист из таблицы открывается в новой вкладке ---
const placeLink = page
  .locator("tbody button")
  .filter({ hasText: /стр\. \d+/ })
  .first();
if (await placeLink.count()) {
  // Обычный клик уводит на лист в этой же вкладке; новая — только с Ctrl.
  const [popup] = await Promise.all([
    context.waitForEvent("page", { timeout: 30000 }),
    placeLink.click({ modifiers: ["Control"] }),
  ]);
  await popup.waitForLoadState("domcontentloaded");
  // Deep-link: ждём, пока workspace снимет «Загрузка…» и откроет лист.
  await popup.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 60000 });
  // Возврат из листа называется «← К проектам»: отдельной «На главную» нет.
  await popup
    .getByRole("button", { name: /К проектам/ })
    .first()
    .waitFor({ timeout: 30000 });
  const popupText = (await popup.locator("body").innerText()).replace(/\s+/g, " ");
  check(
    "лист открылся в новой вкладке",
    /лист \d+ из|К проектам/.test(popupText) && !/^Загрузка/.test(popupText.trim()),
    popupText.slice(0, 160),
  );
  check(
    "лист: правка текста убрана",
    (await popup.locator('button[title="Исправить расшифровку"]').count()) === 0,
  );
  check(
    "шапка: стрелки и поиск на месте",
    (await popup.getByTitle(/Предыдущий лист/).count()) > 0 &&
      (await popup.getByTitle(/Поиск по файлу|Закрыть поиск/).count()) > 0,
  );
  // Табов «Оба/Чертёж/Текст» больше нет: панели скрываются шевронами, а масштаб
  // живёт в тулбаре вьюера.
  check(
    "лист: расшифровка скрывается шевроном",
    (await popup.getByLabel(/Скрыть расшифровку/).count()) > 0,
  );
  check(
    "лист: масштаб и шаги листа в тулбаре вьюера",
    (await popup.getByRole("button", { name: /^\d+%$/ }).count()) > 0 &&
      (await popup.getByLabel("Следующий лист").count()) > 0,
  );
  await popup.close();
  check(
    "таблица замечаний на месте",
    (await page.getByRole("button", { name: /К проектам/ }).count()) > 0 ||
      (await page.getByText(/Замечания ·/).count()) > 0,
  );
} else {
  check("лист в новой вкладке", false, "нет ссылки на место в ПД");
}

await browser.close();

const failed = checks.filter((item) => !item.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} проверок прошло`);
process.exit(failed.length ? 1 : 0);
