/**
 * Играет роль агента Данила на демо: берёт свежерасшифрованный документ и
 * присылает по нему замечания той же ручкой, что описана в reviews-contract.md.
 *
 *   npm run demo:agent                     # последний загруженный документ
 *   npm run demo:agent -- <documentId>
 *
 * Цитаты берутся из настоящей расшифровки листов, поэтому переход к листу в
 * таблице открывает именно то место, на которое ссылается замечание.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.PTO_DEMO_URL || "http://localhost:8080";

/** Токен ингеста лежит в .env.local — тот же, что отдаём конвейеру. */
async function ingestToken(): Promise<string> {
  if (process.env.PTO_INGEST_TOKEN) return process.env.PTO_INGEST_TOKEN;
  const env = await readFile(path.resolve(".env.local"), "utf8");
  const line = env
    .split(/\r?\n/)
    .find((item) => item.startsWith("PTO_INGEST_TOKEN="));
  if (!line) throw new Error("В .env.local нет PTO_INGEST_TOKEN");
  return line.slice("PTO_INGEST_TOKEN=".length).trim();
}

async function session(): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      login: process.env.PTO_DEMO_LOGIN || "admin",
      password: process.env.PTO_DEMO_PASSWORD || "admin123",
    }),
  });
  if (!response.ok) throw new Error(`Вход не удался: ${response.status}`);
  return response.headers
    .getSetCookie()
    .map((item) => item.split(";")[0])
    .join("; ");
}

type Page = { pageNumber: number; markdown: string };
type Doc = {
  id: string;
  projectId: string;
  originalName: string;
  pageCount: number;
  readyPages: number;
  createdAt: string;
  pages: Page[];
};

const cookie = await session();
const wanted = process.argv[2];

const { documents = [] } = (await (
  await fetch(`${BASE}/api/documents`, { headers: { cookie } })
).json()) as { documents: Doc[] };

const target = wanted
  ? documents.find((item) => item.id === wanted)
  : documents[0];
if (!target) throw new Error("Документ не найден");

const full = (await (
  await fetch(`${BASE}/api/documents/${target.id}`, { headers: { cookie } })
).json()) as { document: Doc };
const doc = full.document;

console.log(`документ: ${doc.originalName}`);
console.log(`расшифровано: ${doc.readyPages}/${doc.pageCount}`);
if (doc.readyPages === 0) {
  throw new Error("Лист ещё не расшифрован — агенту нечего читать");
}

/** Цитата из расшифровки: первая содержательная строка листа. */
function quoteOf(pageNumber: number): string {
  const page = doc.pages.find((item) => item.pageNumber === pageNumber);
  const line = (page?.markdown ?? "")
    .split(/\r?\n/)
    .map((item) => item.replace(/^[#>|*\-\s]+/, "").trim())
    .find((item) => item.length > 12 && !item.startsWith("---"));
  return (line ?? "").slice(0, 120);
}

const ready = doc.pages
  .map((page) => page.pageNumber)
  .sort((left, right) => left - right);
const pick = (index: number) => ready[Math.min(index, ready.length - 1)];

function loc(pageNumber: number) {
  return {
    documentId: doc.id,
    documentName: doc.originalName,
    pageNumber,
    quote: quoteOf(pageNumber),
  };
}

// Замечания сформулированы так, как их присылал бы агент: раздел, обоснование,
// места в ПД. Первое ссылается на два листа — это расхождение между листами.
const reviews = [
  {
    section: "ИОС2",
    aiFinding:
      "Расход воды на внутреннее пожаротушение на листах расходится: в расчётной части одно значение, в спецификации оборудования другое. Нужна единая цифра.",
    severity: "high" as const,
    locations: [loc(pick(0)), loc(pick(2))],
  },
  {
    section: "ИОС2",
    aiFinding:
      "На листе нет ссылки на узел ввода: узел показан условно, деталировка и привязка к осям отсутствуют.",
    severity: "medium" as const,
    locations: [loc(pick(1))],
  },
  {
    section: "ИОС2",
    aiFinding:
      "Материал и диаметр трубопровода в спецификации указаны как «по указанию» — параметр не задан.",
    severity: "low" as const,
    locations: [loc(pick(3))],
  },
];

const response = await fetch(`${BASE}/api/projects/${doc.projectId}/reviews`, {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await ingestToken()}`,
  },
  body: JSON.stringify({ reviews }),
});

const result = await response.json();
console.log(`ответ ${response.status}:`, JSON.stringify(result));
console.log("\nобнови таблицу замечаний — строки появятся с ссылками на листы");
