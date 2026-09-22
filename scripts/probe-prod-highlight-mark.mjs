import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const shots = join(dirname(fileURLToPath(import.meta.url)), "..", "samples", "shots");
const BASE = process.env.PTO_BASE_URL || "https://201.24.50.177";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
  timeout: 60000,
});

const { projects = [] } = await (await ctx.request.get(`${BASE}/api/projects`)).json();
const project = projects.find((p) => /TestUI|Lexx/i.test(p.name)) ?? projects[0];
const { reviews = [] } = await (
  await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
).json();
const { documents = [] } = await (
  await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
).json();
const pdf = documents.find((d) => /\.pdf$/i.test(d.originalName));
const withRect = reviews.find((r) => (r.locations || []).some((l) => l.rect && l.documentId === pdf?.id));
const loc = withRect?.locations.find((l) => l.rect && l.documentId === pdf?.id);

const page = await ctx.newPage();
const logs = [];
page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) logs.push(`${msg.type()}: ${msg.text()}`);
});

if (loc) {
  const url = `${BASE}/?project=${project.id}&doc=${loc.documentId}&page=${loc.pageNumber}&from=reviews&review=${withRect.id}&quote=${encodeURIComponent(loc.quote || "")}`;
  console.log("JUMP", url.slice(0, 180));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const info = await page.evaluate(() => ({
    zones: document.querySelectorAll(".pto-remark-zone").length,
    marks: document.querySelectorAll("mark").length,
    notFound: /цитата не найдена/i.test(document.body.innerText),
    quoteBanner: [...document.querySelectorAll("div,span,p")].some((n) =>
      /подсвет|цитата/i.test(n.textContent || ""),
    ),
    title: document.body.innerText.slice(0, 400),
  }));
  console.log("HIGHLIGHT", info);
  await page.screenshot({ path: join(shots, "prod-jump-page10.png") });
}

await page.goto(`${BASE}/?project=${project.id}&doc=${pdf.id}&page=1`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
await page.waitForTimeout(3000);
await page.getByRole("button", { name: /Отметить ошибку/ }).first().click();
await page.waitForTimeout(400);
const host = page.locator("[data-page-host], .relative.overflow-hidden").first();
const box =
  (await page.locator("canvas").first().boundingBox()) ||
  (await host.boundingBox());
console.log("CANVAS", box);
if (box) {
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 180, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
}
const form = page.getByPlaceholder("Что неверно");
const formOn = await form.count();
console.log("FORM", formOn);
if (formOn > 0) {
  await form.fill("Проверка пометки: площадь 2450 против 2180");
  await page.getByPlaceholder(/Как должно быть/i).fill("2180 м2");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await page.waitForTimeout(2000);
}
await page.screenshot({ path: join(shots, "prod-mark-after.png") });

const after = await (
  await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
).json();
const docsAfter = await (
  await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
).json();
const anns = (docsAfter.documents || []).flatMap((d) =>
  (d.pages || []).flatMap((p) =>
    (p.annotations || []).map((a) => ({
      page: p.pageNumber ?? p.number,
      comment: a.comment,
      reviewId: a.reviewId,
    })),
  ),
);
const engineer = (after.reviews || []).filter((r) => r.origin === "engineer" || r.origin === "both");
console.log("AFTER_REVIEWS", after.reviews?.length, "engineer", engineer.length, "anns", anns);
console.log("ENGINEER", JSON.stringify(engineer.slice(-2), null, 0));
console.log("ANNS", JSON.stringify(anns));
console.log("CONSOLE", logs.slice(0, 12));

if (engineer.length) {
  const last = engineer.at(-1);
  const del = await ctx.request.delete(
    `${BASE}/api/projects/${project.id}/reviews/${last.id}`,
  );
  console.log("DEL", del.status());
  const docs2 = await (
    await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}`)
  ).json();
  const left = (docs2.documents || []).flatMap((d) =>
    (d.pages || []).flatMap((p) => p.annotations || []),
  );
  console.log("LEFT_ANN", left.length, "orphan", left.some((a) => a.reviewId === last.id));
}

await browser.close();
