/**
 * Сторож палитры: цветов статуса должно быть три, и старые смыслы не должны
 * вернуться. Без этого палитра расползается обратно через месяц.
 * Запуск: node scripts/palette-check.mjs
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("src");
let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(SRC);

// ------------------------------------------------- цвета статуса только токенами

const colors = fs.readFileSync(
  path.join(SRC, "lib", "review-colors.ts"),
  "utf8",
);
// Кроме slate: нейтраль — не смысл, её оставляем на утилитах Tailwind.
const raw = [
  ...colors.matchAll(
    /\b(?:bg|text|border|border-l)-(red|orange|sky|violet|amber|rose|emerald|green|yellow)-\d{2,3}\b/g,
  ),
].map((m) => m[0]);
check(
  "review-colors.ts не красит статус напрямую",
  raw.length === 0,
  raw.length ? raw.join(", ") : "только токены sem-*",
);

const tokens = [...colors.matchAll(/sem-(issue|ok|attn)/g)].map((m) => m[1]);
check(
  "в палитре статуса ровно три смысла",
  new Set(tokens).size === 3,
  [...new Set(tokens)].sort().join(", "),
);

// ------------------------------------------------------ violet нигде не остался

const violet = files.filter((file) =>
  /\b(?:bg|text|border|ring|from|to)-violet-/.test(fs.readFileSync(file, "utf8")),
);
check(
  "violet выведен из обращения",
  violet.length === 0,
  violet.map((f) => path.relative(SRC, f)).join(", "),
);

// ------------------------- табы этапов на accent, а не на sky / violet

const stages = fs.readFileSync(
  path.join(SRC, "components", "project-stages.tsx"),
  "utf8",
);
const stageTab = /const STAGE_TAB[\s\S]*?\n};/.exec(stages)?.[0] ?? "";
check(
  "табы этапов на accent",
  stageTab.includes("accent") && !/-(sky|violet)-/.test(stageTab),
  stageTab ? "" : "STAGE_TAB не найден",
);

// --------------------- заливку строки таблицы даёт только разбор, не важность

const severityRow = /export const SEVERITY_ROW[\s\S]*?\n};/.exec(colors)?.[0] ?? "";
const bgInSeverity = [...severityRow.matchAll(/\bbg-[a-z]+-?[a-z0-9/]*/g)].map(
  (m) => m[0],
);
check(
  "важность не красит фон строки",
  bgInSeverity.length === 0,
  bgInSeverity.join(", ") || "только border-l",
);
check(
  "важность передаётся толщиной полосы",
  /border-l-2/.test(severityRow) && /border-l-4/.test(severityRow),
  "border-l-2 / border-l-4",
);

// --------------------------------------- обе оси зафиксированы в документации

const doc = fs.readFileSync(
  path.resolve("docs", "page-contract.md"),
  "utf8",
);
check(
  "оси цвета описаны в docs/page-contract.md",
  /Две оси цвета/.test(doc) &&
    ["--sem-issue", "--sem-ok", "--sem-attn"].every((t) => doc.includes(t)),
);

console.log(failures ? `\nпровалов: ${failures}` : "\nпалитра сведена");
process.exit(failures ? 1 : 0);
