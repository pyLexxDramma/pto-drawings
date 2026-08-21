/**
 * Playwright: upload → click cancel (banner or Стоп) → assert POST /cancel.
 * node scripts/playwright-cancel-check.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BASE = process.env.PTO_BASE_URL || "http://localhost:3000";

function pickPdf() {
  const uploads = path.join(ROOT, "uploads");
  const hit = fs
    .readdirSync(uploads)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => path.join(uploads, f))
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  if (!hit) throw new Error("No PDF in uploads/");
  return hit;
}

const out = {
  cancelRequests: 0,
  cancelResponses: [],
  clicked: null,
  ui: null,
  ok: false,
};

fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

page.on("request", (req) => {
  if (req.method() === "POST" && /\/api\/documents\/[^/]+\/cancel\b/.test(req.url())) {
    out.cancelRequests += 1;
    console.log("REQ cancel", req.url());
  }
});
page.on("response", async (res) => {
  if (res.request().method() === "POST" && /\/api\/documents\/[^/]+\/cancel\b/.test(res.url())) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    out.cancelResponses.push({
      status: res.status(),
      errorMessage: body?.document?.errorMessage ?? body?.error ?? null,
      docStatus: body?.document?.status ?? null,
    });
    console.log("RES cancel", res.status(), body?.document?.errorMessage ?? body?.error);
  }
});

try {
  const loginRes = await context.request.post(`${BASE}/api/auth/login`, {
    data: { login: "admin", password: "admin123" },
  });
  if (!loginRes.ok()) throw new Error(`login ${loginRes.status()}`);

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 30000 });

  const projectBtn = page.getByRole("button", { name: /Объект 1/i }).first();
  await projectBtn.waitFor({ state: "visible", timeout: 30000 });
  await projectBtn.click();
  await page.waitForTimeout(400);

  const fileInput = page.locator("#pto-drawing-upload");
  await fileInput.waitFor({ state: "attached", timeout: 15000 });
  console.log("upload", pickPdf());
  await fileInput.setInputFiles(pickPdf());

  const stopBtn = page.getByRole("button", { name: /^Стоп$/ });
  const bannerCancel = page.getByRole("button", { name: /^Отменить обработку$/ });

  // Ждём любую кнопку отмены, пока mock ещё крутится
  const which = await Promise.race([
    stopBtn.waitFor({ state: "visible", timeout: 60000 }).then(() => "stop"),
    bannerCancel.waitFor({ state: "visible", timeout: 60000 }).then(() => "banner"),
  ]);
  console.log("cancel control=", which);
  out.clicked = which;

  const bar = page.getByTestId("global-process-bar");
  const barVisible = await bar.isVisible().catch(() => false);
  console.log("progressBarVisible=", barVisible);
  if (barVisible) {
    console.log("progressBarLabel=", await bar.getAttribute("aria-label"));
  }
  out.progressBarVisible = barVisible;

  if (which === "stop") await stopBtn.first().click();
  else await bannerCancel.click();

  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    if (out.cancelResponses.some((r) => r.status === 200)) break;
  }

  const bodyText = await page.locator("body").innerText();
  out.ui = {
    hasCancelPending: /Отмена/.test(bodyText),
    stopVisible: await stopBtn.first().isVisible().catch(() => false),
    bannerVisible: await bannerCancel.isVisible().catch(() => false),
    lines: bodyText
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((l) => /Отмен|Стоп|очеред|Обработ|ошибк|Готово/i.test(l))
      .slice(0, 20),
  };

  out.ok =
    out.progressBarVisible &&
    out.cancelRequests > 0 &&
    out.cancelResponses.some((r) => r.status === 200) &&
    (out.ui.hasCancelPending ||
      out.cancelResponses.some(
        (r) =>
          String(r.errorMessage || "").startsWith("Отмена") ||
          String(r.errorMessage || "").includes("отменена") ||
          r.docStatus === "error",
      ));

  console.log(JSON.stringify(out, null, 2));
  await page.screenshot({
    path: path.join(ROOT, "logs", out.ok ? "cancel-check-ok.png" : "cancel-check-fail.png"),
    fullPage: true,
  });
  process.exitCode = out.ok ? 0 : 1;
} catch (err) {
  console.error("FAIL", err);
  console.log(
    "DUMP",
    await page
      .evaluate(() => ({
        text: document.body?.innerText?.slice(0, 1200),
        buttons: [...document.querySelectorAll("button")]
          .map((b) => (b.textContent || "").trim().replace(/\s+/g, " "))
          .filter(Boolean)
          .slice(0, 40),
      }))
      .catch(() => null),
  );
  await page.screenshot({
    path: path.join(ROOT, "logs", "cancel-check-error.png"),
    fullPage: true,
  }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
