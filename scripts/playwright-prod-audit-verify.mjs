// Прод: журналы правок доступны только админу, чипа конвейера в шапке нет.
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

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
const me = await (await context.request.get(`${BASE}/api/auth/me`)).json();
const role = me?.user?.role ?? "?";
console.log(`инфо — роль: ${role} (${me?.user?.displayName ?? "—"})`);

const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const chipInHeader = await page.getByText(/^Конвейер[:\s]/).count();
check("шапка: чипа конвейера нет", chipInHeader === 0, `найдено ${chipInHeader}`);

await page.getByRole("button", { name: /роль:|▾/ }).first().click();
await page.waitForTimeout(400);
const menu = page.locator("[role=menu]").first();
const menuText = (await menu.innerText()).replace(/\s+/g, " ");

const api = await context.request.get(`${BASE}/api/audit?kind=reviews`);

if (role === "admin") {
  check("меню: есть «Журналы правок»", /Журналы правок/.test(menuText), menuText.slice(0, 140));
  check("api: админу доступно", api.ok(), String(api.status()));
  await menu.getByRole("menuitem", { name: "Журналы правок" }).click();
  const dialog = page.getByRole("dialog", { name: "Журналы правок" });
  await dialog.waitFor({ timeout: 15000 });
  for (const tab of [
    "Замечания",
    "Правки текста",
    "Ошибки на чертежах",
    "Файлы",
    "Обновления прода",
  ]) {
    await dialog.getByRole("tab", { name: tab, exact: true }).click();
    await page.waitForTimeout(1500);
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    const broken = /Не удалось|Только для админа|Неизвестный раздел/.test(text);
    check(`вкладка «${tab}»`, !broken, broken ? text.slice(0, 140) : "");
  }
  const releases = (await dialog.innerText()).replace(/\s+/g, " ");
  check("прод: коммиты видны", /коммиты в main/i.test(releases));
  check(
    "прод: git-история доступна",
    !/История коммитов недоступна/.test(releases),
    releases.slice(0, 160),
  );
  check("прод: есть отметка запуска", !/Отметок пока нет/.test(releases));
  await page.screenshot({ path: `${process.env.TEMP}/shot-prod-audit.png` });
} else {
  check("меню: инженеру журналов нет", !/Журналы правок/.test(menuText), menuText.slice(0, 140));
  check("api: инженеру 403", api.status() === 403, String(api.status()));
}

await browser.close();
console.log(failed ? `\nПровалено проверок: ${failed}` : "\nВсе проверки прошли");
process.exit(failed ? 1 : 0);
