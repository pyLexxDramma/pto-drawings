// Смоук журналов правок: меню пользователя, вкладки, чип конвейера в меню.
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE || "http://localhost:3000";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";

let failed = 0;
function check(name, ok, extra = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok" : "FAIL"} — ${name}${extra ? ` — ${extra}` : ""}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const auth = await context.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
});
check("login", auth.ok(), String(auth.status()));

const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

// Чип конвейера убран из шапки.
const chipInHeader = await page.getByText(/^Конвейер[:\s]/).count();
check("шапка: чипа конвейера нет", chipInHeader === 0, `найдено ${chipInHeader}`);

await page.getByRole("button", { name: /роль:|▾/ }).first().click();
await page.waitForTimeout(300);
const menu = page.locator("[role=menu]").first();
const menuText = (await menu.innerText()).replace(/\s+/g, " ");
// Локально конвейер не поднят — заметка о нём появляется только когда он отвечает.
console.log(`инфо — заметка о конвейере в меню: ${/онвейер/.test(menuText) ? "есть" : "нет (конвейер не отвечает)"}`);
check("меню: есть «Журналы правок»", /Журналы правок/.test(menuText));

await menu.getByRole("menuitem", { name: "Журналы правок" }).click();
const dialog = page.getByRole("dialog", { name: "Журналы правок" });
await dialog.waitFor({ timeout: 10000 });

for (const tab of [
  "Замечания",
  "Правки текста",
  "Ошибки на чертежах",
  "Файлы",
  "Обновления прода",
]) {
  await dialog.getByRole("tab", { name: tab, exact: true }).click();
  await page.waitForTimeout(1200);
  const text = (await dialog.innerText()).replace(/\s+/g, " ");
  const broken = /Не удалось|Только для админа|Неизвестный раздел/.test(text);
  check(`вкладка «${tab}»`, !broken, broken ? text.slice(0, 160) : "");
  if (tab === "Замечания") {
    await page.screenshot({ path: `${process.env.TEMP}/shot-audit-reviews.png` });
  }
}

const releasesText = (await dialog.innerText()).replace(/\s+/g, " ");
check("прод: коммиты видны", /коммиты в main/i.test(releasesText));
check("прод: ветки коллег видны", /ветки коллег/i.test(releasesText));
check(
  "прод: ветка со статусом",
  /слита|не выкачена/.test(releasesText),
  releasesText.slice(0, 200),
);
check(
  "прод: история не пустая",
  !/История коммитов недоступна/.test(releasesText),
  releasesText.slice(0, 200),
);

await page.screenshot({ path: process.env.TEMP + "/shot-audit.png", fullPage: false });

const forbidden = await context.request.get(`${BASE}/api/audit?kind=reviews`);
check("api: админу доступно", forbidden.ok(), String(forbidden.status()));

await browser.close();
console.log(failed ? `\nПровалено проверок: ${failed}` : "\nВсе проверки прошли");
process.exit(failed ? 1 : 0);
