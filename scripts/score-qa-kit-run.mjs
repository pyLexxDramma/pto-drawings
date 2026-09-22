/** Сверка прогона qa-kit с 16 заложенными расхождениями. */
const base = process.env.PTO_BASE_URL || "https://pto.tw1.su";
const LOGIN = process.env.PTO_LOGIN || "qa_engineer";
const PASSWORD = process.env.PTO_PASSWORD || "QaTest-2026!";

const CATALOG = [
  { id: "01", keys: ["2450", "2180"], label: "площадь застройки 2450 / 2180 м2" },
  { id: "02", keys: ["1:100", "1:200", "масштаб"], label: "масштаб 1:100 / 1:200" },
  { id: "03", keys: ["12.50", "11.80", "12,50", "11,80"], label: "длина L=12.50 / 11.80 м" },
  { id: "04", keys: ["ВСХН", "7 шт", "4 шт"], label: "ВСХН-20: 7 шт / 4 шт" },
  { id: "05", keys: ["+0.150", "+0.250", "0.150", "0.250"], label: "отметка пола +0.150 / +0.250" },
  { id: "06", keys: ["54.00", "51.60", "54,00", "51,60"], label: "высота здания 54.00 / 51.60 м" },
  { id: "07", keys: ["86", "72", "машиноме"], label: "машиноместа 86 / 72" },
  { id: "08", keys: ["огнестойк", " II", " III"], label: "огнестойкость II / III" },
  { id: "09", keys: ["1000", "630", "лифт"], label: "лифт 1000 / 630 кг" },
  { id: "10", keys: ["Ду100", "Ду80", "ду 100", "ду 80"], label: "ввод Ду100 / Ду80" },
  { id: "11", keys: ["17", "16", "этаж"], label: "этажей 17 / 16" },
  { id: "12", keys: ["28", "35", "озелен"], label: "озеленение 28 % / 35 %" },
  { id: "13", keys: ["38.4", "42.1", "38,4", "42,1", "квартир"], label: "квартира 105: 38.4 / 42.1 м2" },
  { id: "14", keys: ["1.20", "1.35", "1,20", "1,35", "марш"], label: "ширина марша 1.20 / 1.35 м" },
  { id: "15", keys: ["250", "180", "кВт", "квт"], label: "мощность 250 / 180 кВт" },
  { id: "16", keys: ["18 шт", "12", "итого"], label: "итого оборудования 18 шт / сумма 12" },
];

function pairHit(text, keys) {
  const t = text.toLowerCase();
  const hits = keys.filter((k) => t.includes(k.toLowerCase()));
  return hits.length;
}

async function fetchRetry(url, init = {}, tries = 6) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

const loginRes = await fetchRetry(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ login: LOGIN, password: PASSWORD }),
});
if (!loginRes.ok) throw new Error(`login ${loginRes.status}`);
const cookie = (loginRes.headers.getSetCookie() || [])
  .map((c) => c.split(";")[0])
  .join("; ");
const get = async (path) =>
  (await fetchRetry(`${base}${path}`, { headers: { cookie } })).json();

const { projects = [] } = await get("/api/projects");
const project =
  projects.find((p) => /Lexx/i.test(p.name)) ||
  projects.find((p) => /Test/i.test(p.name));
if (!project) throw new Error("no project");
const { documents = [] } = await get(`/api/documents?projectId=${project.id}`);
const kitDocs = documents
  .filter((d) => /qa-kit|qa-vlm|qa-mixed|model-dwg/i.test(d.originalName))
  .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

console.log(`PROJECT ${project.name} ${project.id}`);
console.log(
  "DOCS",
  documents.map((d) => `${d.originalName} ${d.createdAt} ${d.status} ${d.kitId ?? "-"}`).join(" | "),
);

const { reviews = [] } = await get(`/api/projects/${project.id}/reviews`);
const newestKit = kitDocs[0]?.kitId;
const focusDocs = newestKit
  ? documents.filter((d) => d.kitId === newestKit)
  : kitDocs.slice(0, 4);

if (focusDocs.length === 0) {
  console.log("NO_KIT_DOCS — dump recent");
  for (const d of documents.slice(0, 8)) {
    console.log(
      `  ${d.originalName} ${d.id} ${d.status} pages=${d.pageCount} ready=${d.readyPages} mode=${d.pipelineMode} model=${d.pipelineModel} created=${d.createdAt}`,
    );
  }
}

for (const d of focusDocs) {
  console.log("\n======== FILE");
  console.log(
    JSON.stringify(
      {
        name: d.originalName,
        id: d.id,
        status: d.status,
        pages: d.pageCount,
        ready: d.readyPages,
        mode: d.pipelineMode,
        model: d.pipelineModel,
        elapsed: d.pipelineElapsedSec,
        error: d.errorMessage,
        created: d.createdAt,
        kit: d.kitId,
        role: d.kitRole,
      },
      null,
      2,
    ),
  );
}

const focusIds = new Set(focusDocs.map((d) => d.id));
const kitReviews = reviews.filter((r) =>
  (r.locations || []).some((l) => focusIds.has(l.documentId)) ||
  /qa-kit|qa-vlm|qa-mixed/i.test(`${r.aiFinding || ""} ${r.text || ""}`),
);

console.log(`\n======== REVIEWS kit=${kitReviews.length} project=${reviews.length}`);
for (const r of kitReviews.length ? kitReviews : reviews.slice(0, 80)) {
  const blob = [r.aiFinding, r.text, r.section, ...(r.locations || []).map((l) => l.quote)]
    .filter(Boolean)
    .join(" | ");
  console.log(
    `\n#${r.number} origin=${r.origin} sev=${r.severity} section=${r.section}`,
  );
  if (r.aiFinding) console.log(`  AI: ${r.aiFinding}`);
  if (r.text) console.log(`  TXT: ${r.text}`);
  for (const l of r.locations || []) {
    console.log(
      `  → ${l.documentName} p${l.pageNumber} rect=${l.rect ? "yes" : "no"} «${l.quote || ""}»`,
    );
  }
  const matched = CATALOG.filter((c) => pairHit(blob, c.keys) >= 2).map((c) => c.id);
  const weak = CATALOG.filter((c) => pairHit(blob, c.keys) === 1).map((c) => c.id);
  if (matched.length) console.log(`  MATCH ${matched.join(",")}`);
  else if (weak.length) console.log(`  WEAK ${weak.join(",")}`);
}

const allBlob = (kitReviews.length ? kitReviews : reviews)
  .map((r) =>
    [r.aiFinding, r.text, ...(r.locations || []).map((l) => l.quote)]
      .filter(Boolean)
      .join(" "),
  )
  .join("\n");

console.log("\n======== SCORE");
for (const c of CATALOG) {
  const n = pairHit(allBlob, c.keys);
  const mark = n >= 2 ? "FOUND" : n === 1 ? "WEAK" : "MISS";
  console.log(`${mark} ${c.id} ${c.label} (keys=${n})`);
}
