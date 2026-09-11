/**
 * Проверка подсветки на русском PDF с битым text layer (ИОС2-1).
 */
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
let ok = true;
function check(name, pass, detail = "") {
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) ok = false;
}

try {
  await context.request.post(`${BASE}/api/auth/login`, {
    data: { login: LOGIN, password: PASSWORD },
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 });

  // project with IOS file
  const proj = page.getByRole("button", { name: /dramma_test|lexxdramma/i }).first();
  if (await proj.count()) await proj.click();
  await page.waitForTimeout(500);

  const fileBtn = page.getByRole("button", { name: /ИОС2\)-1\.pdf|IOS2.*-1\.pdf/i }).first();
  if (!(await fileBtn.count())) {
    // try partial
    const alt = page.locator("button").filter({ hasText: /ИОС2/ }).first();
    await alt.click({ timeout: 10000 });
  } else {
    await fileBtn.click();
  }
  await page.getByRole("button", { name: /На главную/ }).waitFor({ timeout: 30000 });

  await page.waitForFunction(
    () => {
      const canvas = document.querySelector("canvas");
      return canvas && canvas.width > 100;
    },
    null,
    { timeout: 90000 },
  );
  await page.waitForTimeout(2000);

  const meta = await page.evaluate(() => ({
    regions: Number(
      document.querySelector("[data-sync-regions]")?.getAttribute("data-sync-regions") || 0,
    ),
    links: Number(
      document.querySelector("[data-sync-links]")?.getAttribute("data-sync-links") || 0,
    ),
  }));
  check("zones", meta.regions > 0, `regions=${meta.regions} links=${meta.links}`);

  await page.getByRole("tab", { name: "Подсветка" }).click();
  await page.waitForTimeout(300);

  const blocks = page.locator("[data-md-block]");
  const n = await blocks.count();
  let found = false;
  for (let i = 0; i < n; i += 1) {
    const t = ((await blocks.nth(i).innerText()) || "").trim();
    if (/общество|КУРСКРЕГИОН|регистрационн/i.test(t)) {
      await blocks.nth(i).scrollIntoViewIfNeeded();
      await blocks.nth(i).click({ force: true });
      await page.waitForTimeout(500);
      const selected = (await blocks.nth(i).getAttribute("data-md-block-selected")) === "true";
      const overlays = await page.evaluate(
        () =>
          [...document.querySelectorAll("div")].filter(
            (el) => /emerald/i.test(el.className) && el.className.includes("absolute"),
          ).length,
      );
      check("MD selected", selected, t.slice(0, 50));
      check("drawing overlay", overlays > 0, `overlays=${overlays}`);
      found = true;
      break;
    }
  }
  if (!found) check("found org block", false);

  // reverse: click upper area of canvas
  const box = await page.locator("canvas").first().boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.12);
    await page.waitForTimeout(400);
    const sel = await page.locator('[data-md-block-selected="true"]').count();
    check("draw→text", sel > 0, `selected=${sel}`);
  }
} catch (e) {
  ok = false;
  console.error("ERROR", e);
} finally {
  await page.screenshot({ path: "logs/ios2-highlight.png", animations: "disabled" }).catch(() => {});
  await browser.close();
  console.log(ok ? "\nALL PASS" : "\nHAS FAILURES");
  process.exit(ok ? 0 : 1);
}
