/**
 * Следит за комплектом qa-kit на проде, пишет в терминал, по финишу — сверка 16 пар.
 *
 *   node scripts/watch-qa-kit.mjs
 *   node scripts/watch-qa-kit.mjs --once
 */
const base = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";
const ONCE = process.argv.includes("--once");
const POLL_MS = Number(process.env.QA_WATCH_MS || 30000);

const CATALOG = [
  { id: "01", keys: ["2450", "2180"], label: "площадь 2450 / 2180" },
  { id: "02", keys: ["1:100", "1:200", "масштаб"], label: "масштаб 1:100 / 1:200" },
  { id: "03", keys: ["12.50", "11.80", "12,50", "11,80"], label: "L=12.50 / 11.80" },
  { id: "04", keys: ["ВСХН", "7 шт", "4 шт"], label: "ВСХН-20 7 / 4" },
  { id: "05", keys: ["+0.150", "+0.250", "0.150", "0.250"], label: "пол +0.150 / +0.250" },
  { id: "06", keys: ["54.00", "51.60", "54,00", "51,60"], label: "высота 54.00 / 51.60" },
  { id: "07", keys: ["86", "72", "машиноме"], label: "машиноместа 86 / 72" },
  { id: "08", keys: ["огнестойк", " II", " III"], label: "огнестойкость II / III" },
  { id: "09", keys: ["1000", "630", "лифт"], label: "лифт 1000 / 630" },
  { id: "10", keys: ["Ду100", "Ду80", "ду 100", "ду 80"], label: "Ду100 / Ду80" },
  { id: "11", keys: ["17", "16", "этаж"], label: "этажи 17 / 16" },
  { id: "12", keys: ["28", "35", "озелен"], label: "озеленение 28 / 35" },
  { id: "13", keys: ["38.4", "42.1", "38,4", "42,1", "квартир"], label: "кв.105 38.4 / 42.1" },
  { id: "14", keys: ["1.20", "1.35", "1,20", "1,35", "марш"], label: "марш 1.20 / 1.35" },
  { id: "15", keys: ["250", "180", "кВт", "квт"], label: "мощность 250 / 180" },
  { id: "16", keys: ["18 шт", "12", "итого"], label: "итог 18 шт / сумма 12" },
];

function now() {
  return new Date().toLocaleTimeString("ru-RU", { hour12: false });
}

function log(line) {
  console.log(`[${now()}] ${line}`);
}

function pairHit(text, keys) {
  const t = text.toLowerCase();
  return keys.filter((k) => t.includes(k.toLowerCase())).length;
}

async function fetchRetry(url, init = {}, tries = 6) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw last;
}

async function login() {
  const res = await fetchRetry(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: LOGIN, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  return (res.headers.getSetCookie() || []).map((c) => c.split(";")[0]).join("; ");
}

function finished(doc) {
  return doc.status === "done" || doc.status === "error";
}

function pickKit(documents) {
  const kits = documents.filter((d) =>
    /qa-kit|qa-vlm|qa-mixed|model-dwg/i.test(d.originalName),
  );
  kits.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const newest = kits[0];
  if (!newest) return [];
  if (newest.kitId) return documents.filter((d) => d.kitId === newest.kitId);
  return [newest];
}

function lineOf(doc) {
  const total = Math.max(doc.pageCount || 0, 1);
  const ready = doc.readyPages ?? 0;
  const page = doc.processingPage ? ` л.${doc.processingPage}` : "";
  const err = doc.errorMessage ? ` · ${doc.errorMessage.slice(0, 80)}` : "";
  return `${doc.originalName} ${doc.status} ${ready}/${total}${page} ${doc.pipelineMode ?? "-"} ${doc.pipelineModel ?? ""}${err}`;
}

async function snapshot(cookie) {
  const get = async (path) =>
    (await fetchRetry(`${base}${path}`, { headers: { cookie } })).json();
  const { projects = [] } = await get("/api/projects");
  const project =
    projects.find((p) => /Lexx/i.test(p.name)) ||
    projects.find((p) => /Test/i.test(p.name));
  if (!project) throw new Error("нет проекта Lexx/Test");
  const { documents = [] } = await get(`/api/documents?projectId=${project.id}`);
  const docs = pickKit(documents);
  const { reviews = [] } = await get(`/api/projects/${project.id}/reviews`);
  return { project, docs, reviews };
}

async function analyze(cookie, { project, docs, reviews }) {
  const ids = new Set(docs.map((d) => d.id));
  const kitReviews = reviews.filter((r) =>
    (r.locations || []).some((l) => ids.has(l.documentId)),
  );
  const details = [];
  for (const d of docs) {
    const full = await (
      await fetchRetry(`${base}/api/documents/${d.id}`, { headers: { cookie } })
    ).json();
    details.push(full.document ?? d);
  }

  const reviewBlob = kitReviews
    .map((r) =>
      [r.aiFinding, r.text, ...(r.locations || []).map((l) => l.quote)]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");

  const mdByFile = {};
  for (const d of details) {
    const md = (d.pages || []).map((p) => p.markdown || "").join("\n");
    mdByFile[d.originalName] = md;
  }
  const allMd = Object.values(mdByFile).join("\n");

  log("");
  log("======== ФАЙЛЫ ========");
  for (const d of details) {
    const vlm = /модель не вызывалась/i.test(mdByFile[d.originalName] || "")
      ? "VLM нет (текст CAD)"
      : d.pipelineModel
        ? `VLM ${d.pipelineModel}`
        : "VLM ?";
    const recs = kitReviews.filter((r) =>
      (r.locations || []).some((l) => l.documentId === d.id),
    ).length;
    log(
      `${d.originalName} ${d.status} ${d.readyPages}/${d.pageCount} ${Math.round(d.pipelineElapsedSec || 0)}с · ${vlm} · замечаний на файле ${recs}`,
    );
  }

  log("");
  log(`======== ЗАМЕЧАНИЯ ${kitReviews.length} ========`);
  for (const r of kitReviews) {
    log(`#${r.number} ${(r.aiFinding || r.text || "").slice(0, 160)}`);
    for (const l of r.locations || []) {
      log(`   → ${l.documentName} л.${l.pageNumber}`);
    }
  }

  log("");
  log("======== СВЕРКА 16 ========");
  const found = [];
  const weak = [];
  const miss = [];
  const inMd = [];
  for (const c of CATALOG) {
    const n = pairHit(reviewBlob, c.keys);
    const seen = pairHit(allMd, c.keys) >= 2;
    if (seen) inMd.push(c.id);
    if (n >= 2) {
      found.push(c);
      log(`НАШЁЛ  ${c.id} ${c.label}`);
    } else if (n === 1) {
      weak.push(c);
      log(`СЛАБО  ${c.id} ${c.label}`);
    } else {
      miss.push(c);
      log(`МИМО   ${c.id} ${c.label}${seen ? "  (в расшифровке есть)" : ""}`);
    }
  }

  const pdf = details.find((d) => /\.pdf$/i.test(d.originalName));
  const dwg = details.find((d) => /\.(dwg|dxf)$/i.test(d.originalName));
  const pdfReviews = kitReviews.filter((r) =>
    (r.locations || []).some((l) => l.documentId === pdf?.id),
  ).length;
  const pdfSaw = pdf && pairHit(mdByFile[pdf.originalName] || "", ["2450", "2180"]) >= 2;

  log("");
  log("======== ВЫВОД ========");
  log(`нашёл ${found.length}/16 · слабо ${weak.length} · мимо ${miss.length}`);
  if (pdf && pdfReviews === 0 && pdfSaw) {
    log("PDF: модель пары видела, замечаний 0 — баг конвейера, не файла.");
    log("Разработчику модели: после VLM гонять искалку пар по markdown PDF, не только по тексту CAD.");
  } else if (pdf && pdfReviews === 0) {
    log("PDF: замечаний 0, пар в расшифровке мало — смотреть вызов VLM / skip.");
  }
  if (dwg) {
    log(
      `DWG: замечаний ${kitReviews.filter((r) => (r.locations || []).some((l) => l.documentId === dwg.id)).length}.`,
    );
  }
  if (miss.some((c) => inMd.includes(c.id))) {
    log("В файле: пары в тексте есть, искалка их не взяла — одна фраза «принято X, по Y Z».");
  }
  if (found.length >= 12) log("Комплект для сверки ок, править файл не нужно.");
  else if (found.length < 5) log("Если 01–05 пустые — конвейер не видит даже явные пары.");

  log("");
  log("QA_KIT_DONE");
}

let cookie = await login();
log(`вход ок · ${base} · опрос каждые ${POLL_MS / 1000} с`);

let lastKey = "";
for (;;) {
  try {
    if (!cookie) cookie = await login();
    const snap = await snapshot(cookie);
    if (snap.docs.length === 0) {
      log("комплекта qa-kit нет — жду загрузку");
    } else {
      const key = snap.docs
        .map((d) => `${d.id}:${d.status}:${d.readyPages}:${d.processingPage}`)
        .join("|");
      if (key !== lastKey) {
        lastKey = key;
        log(`проект ${snap.project.name}`);
        for (const d of snap.docs) log(`  ${lineOf(d)}`);
      } else {
        log("без изменений");
      }
      if (snap.docs.every(finished)) {
        log("обработка закончилась — сверка");
        await analyze(cookie, snap);
        if (ONCE) break;
        log("жду новый комплект (или Ctrl+C)");
        const doneAt = snap.docs.map((d) => d.createdAt).join();
        while (!ONCE) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          cookie = await login();
          const next = await snapshot(cookie);
          const nextAt = next.docs.map((d) => d.createdAt).join();
          if (nextAt !== doneAt) {
            lastKey = "";
            log("новый комплект — слежу");
            break;
          }
          log("ждём новый прогон");
        }
        if (ONCE) break;
        continue;
      }
    }
  } catch (err) {
    cookie = "";
    log(`сбой: ${err instanceof Error ? err.message : err}`);
  }
  if (ONCE) break;
  await new Promise((r) => setTimeout(r, POLL_MS));
}
