/**
 * Заливает демо-пачку ИОС4 в новый проект на проде и ждёт расшифровку и
 * замечания конвейера. Новый проект — чтобы не мешались прошлые публикации.
 *   PTO_PASSWORD=... node scripts/upload-ios4-demo-prod.mjs
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "admin";
const PASSWORD = process.env.PTO_PASSWORD || "admin123";
const FILE = process.env.PTO_UPLOAD ||
  "D:\\PTO\\пакет-проверки-ПТО\\ИОС4-демо-листы-28-29.pdf";
const NAME = process.env.PTO_PROJECT_NAME ||
  `ИОС4 демо ${new Date().toISOString().slice(0, 10)}`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const login = await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { login: LOGIN, password: PASSWORD },
  timeout: 60000,
});
if (!login.ok()) {
  console.log("вход не удался", login.status());
  process.exit(1);
}

const { projects = [] } = await (await ctx.request.get(`${BASE}/api/projects`)).json();
let project = projects.find((item) => item.name === NAME);
if (!project) {
  const created = await ctx.request.post(`${BASE}/api/projects`, {
    data: { name: NAME },
    timeout: 60000,
  });
  const body = await created.json();
  project = body.project ?? body;
  console.log("проект создан:", project.name, project.id);
} else {
  console.log("проект уже есть:", project.name, project.id);
}

const name = FILE.split(/[\\/]/).pop();
const uploaded = await ctx.request.post(`${BASE}/api/documents`, {
  multipart: {
    projectId: project.id,
    file: { name, mimeType: "application/pdf", buffer: readFileSync(FILE) },
  },
  timeout: 180000,
});
console.log("загрузка:", uploaded.status());
const upBody = await uploaded.json();
if (!uploaded.ok()) {
  console.log(JSON.stringify(upBody).slice(0, 400));
  process.exit(1);
}
const docId = upBody.document?.id;
console.log("файл:", upBody.document?.originalName, docId);

const deadline = Date.now() + 15 * 60 * 1000;
let lastLine = "";
while (Date.now() < deadline) {
  const docs = await (
    await ctx.request.get(`${BASE}/api/documents?projectId=${project.id}&lite=0`)
  ).json();
  const doc = (docs.documents ?? []).find((item) => item.id === docId);
  const { reviews = [] } = await (
    await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
  ).json();
  const line = `${doc?.status} шаг=${doc?.processingStep} листы=${doc?.readyPages}/${doc?.pageCount} замечаний=${reviews.length}${doc?.errorMessage ? ` ОШИБКА=${doc.errorMessage}` : ""}`;
  if (line !== lastLine) {
    console.log(new Date().toISOString().slice(11, 19), line);
    lastLine = line;
  }
  if (doc?.status === "error") break;
  if (doc?.status === "done" && reviews.length > 0) break;
  await new Promise((resolve) => setTimeout(resolve, 15000));
}

const { reviews = [] } = await (
  await ctx.request.get(`${BASE}/api/projects/${project.id}/reviews`)
).json();
console.log(`\nзамечаний: ${reviews.length}`);
for (const review of reviews) {
  const place = (review.locations ?? [])
    .map((loc) => `стр.${loc.pageNumber} «${loc.quote}»${loc.rect ? " +rect" : " БЕЗ rect"}`)
    .join("; ");
  console.log(`№${review.number} ${review.severity} ${review.text || review.aiFinding}`);
  console.log(`    ${place || "мест нет"}`);
}
console.log(`\nпроект: ${BASE}/?project=${project.id}`);
await browser.close();
