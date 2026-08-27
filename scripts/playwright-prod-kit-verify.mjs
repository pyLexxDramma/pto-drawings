/**
 * Smoke: комплект PDF+DWG на prod (API kit + UI).
 */
import { chromium } from "playwright";
import { zipSync } from "fflate";

const BASE = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function login(context) {
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: { login: LOGIN, password: PASSWORD },
  });
  check("login", res.ok(), String(res.status()));
  return res.ok();
}

async function pickSampleFiles(context) {
  const projectsRes = await context.request.get(`${BASE}/api/projects`);
  const { projects = [] } = await projectsRes.json();
  for (const project of projects) {
    const docsRes = await context.request.get(
      `${BASE}/api/documents?projectId=${encodeURIComponent(project.id)}&lite=1`,
    );
    const { documents = [] } = await docsRes.json();
    const pdf = documents.find(
      (d) => d.kitRole == null && /\.pdf$/i.test(d.originalName) && d.status === "done",
    );
    const cad = documents.find(
      (d) => d.kitRole == null && /\.(dwg|dxf)$/i.test(d.originalName) && d.status === "done",
    );
    if (pdf && cad) return { projectId: project.id, projectName: project.name, pdf, cad };
  }
  return null;
}

async function downloadFile(context, docId) {
  const res = await context.request.get(`${BASE}/api/documents/${docId}/file`);
  if (!res.ok()) throw new Error(`file ${docId} ${res.status()}`);
  return Buffer.from(await res.body());
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});

try {
  if (!(await login(context))) process.exit(1);

  const sample = await pickSampleFiles(context);
  check("есть PDF и DWG для теста", Boolean(sample), sample?.projectName ?? "");
  if (!sample) process.exit(1);

  const pdfBuf = await downloadFile(context, sample.pdf.id);
  const cadBuf = await downloadFile(context, sample.cad.id);
  const stamp = Date.now().toString(36);

  // --- API: kit pair ---
  const pairForm = new FormData();
  pairForm.append("projectId", sample.projectId);
  pairForm.append("title", `kit-test-${stamp}`);
  pairForm.append(
    "pdf",
    new Blob([pdfBuf], { type: "application/pdf" }),
    `kit-${stamp}.pdf`,
  );
  pairForm.append(
    "cad",
    new Blob([cadBuf], { type: "application/acad" }),
    sample.cad.originalName,
  );
  const pairRes = await context.request.post(`${BASE}/api/documents/kit`, {
    multipart: pairForm,
  });
  const pairBody = await pairRes.json();
  check(
    "API kit pair",
    pairRes.ok() && pairBody.documents?.length === 2 && pairBody.kitId,
    pairRes.ok() ? `kitId=${pairBody.kitId?.slice(0, 8)}` : JSON.stringify(pairBody),
  );

  // --- API: kit zip ---
  const zipBuf = zipSync({
    [`komplekt-${stamp}.pdf`]: new Uint8Array(pdfBuf),
    [sample.cad.originalName]: new Uint8Array(cadBuf),
  });
  const zipForm = new FormData();
  zipForm.append("projectId", sample.projectId);
  zipForm.append("title", `kit-zip-${stamp}`);
  zipForm.append(
    "archive",
    new Blob([zipBuf], { type: "application/zip" }),
    `komplekt-${stamp}.zip`,
  );
  const zipRes = await context.request.post(`${BASE}/api/documents/kit`, {
    multipart: zipForm,
  });
  const zipBody = await zipRes.json();
  check(
    "API kit zip",
    zipRes.ok() && zipBody.documents?.length === 2,
    zipRes.ok() ? `primary=${zipBody.primaryDocumentId?.slice(0, 8)}` : JSON.stringify(zipBody),
  );

  const primaryId = pairBody.primaryDocumentId || pairBody.documents?.[0]?.id;
  if (!primaryId) throw new Error("no primary doc");

  // --- UI ---
  const page = await context.newPage();
  await page.goto(BASE);
  await page.getByText("Загрузка…").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
  if (await page.getByRole("button", { name: "Открыть проект" }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Открыть проект" }).click();
  }
  await page
    .locator("[data-project-row]")
    .filter({ hasText: sample.projectName })
    .locator("button")
    .first()
    .click();
  await page.waitForTimeout(500);

  check(
    "список: бейдж PDF+DWG",
    (await page.getByText("PDF+DWG", { exact: true }).count()) >= 2,
  );

  await page.locator(`[data-document-row="${primaryId}"] button`).first().click();
  await page.getByRole("button", { name: /На главную/ }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);

  check(
    "просмотр: подпись markdown",
    await page.getByText(/Markdown из PDF/i).isVisible().catch(() => false),
  );

  const pdfTab = page.getByRole("tab", { name: "PDF" });
  const dwgTab = page.getByRole("tab", { name: "DWG" });
  check("просмотр: переключатель PDF", await pdfTab.isVisible().catch(() => false));
  check("просмотр: переключатель DWG", await dwgTab.isVisible().catch(() => false));
  if (await dwgTab.isVisible().catch(() => false)) {
    await dwgTab.click();
    await page.waitForTimeout(1500);
    check(
      "просмотр: DWG выбран",
      (await dwgTab.getAttribute("aria-selected")) === "true",
    );
  }

  // --- upload help on empty-ish view ---
  await page.getByRole("button", { name: /На главную/ }).click();
  await page.waitForTimeout(500);
  check(
    "пустой экран: подсказка расшифровки",
    await page.getByText(/PDF и DWG вместе/i).isVisible().catch(() => false),
  );

  const ok = checks.every((c) => c.pass);
  console.log("\n" + (ok ? "ALL PASS" : "HAS FAILURES"));
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error("ERROR", err);
  process.exit(1);
} finally {
  await browser.close();
}
