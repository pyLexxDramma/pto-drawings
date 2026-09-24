/**
 * Сторож палитры и зонирования: закрепляет решения, которые уже приняты, чтобы
 * они не размылись обратно через месяц.
 *
 * Осей цвета в интерфейсе четыре, и они не смешиваются — подробно в
 * docs/page-contract.md. Сторож проверяет самое ломкое:
 *  1. состояние системы (файл, лист, предупреждение) идёт токенами --sem-*,
 *     и смыслов у них ровно три: ждёт, готово, ошибка;
 *  2. важность замечания и итог разбора — две независимые шкалы, у значений
 *     внутри каждой свой цвет, иначе выпадашка сливается в одно пятно;
 *  3. важность красит только клетку «Замечание» (блеклая заливка + яркая рамка),
 *     не всю строку; статус фон строки не даёт;
 *  4. табы этапов на мягком зелёном, не на sky / violet / ярко-синем accent;
 *  5. цветные зоны левой колонки остаются разделёнными толстой рамкой — их
 *     сделали такими нарочно, чтобы инженер не кликнул не в ту зону.
 *
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

const read = (...parts) => fs.readFileSync(path.join(SRC, ...parts), "utf8");
const block = (source, name) =>
  new RegExp(`(?:const|export const) ${name}[\\s\\S]*?\\n};`).exec(source)?.[0] ?? "";

// --------------------------------------- 1. состояние системы — только токенами

const css = fs.readFileSync(path.resolve("src", "app", "globals.css"), "utf8");
const semFamilies = new Set(
  [...css.matchAll(/--sem-(issue|ok|attn)\b/g)].map((m) => m[1]),
);
check(
  "у состояния системы ровно три смысла",
  semFamilies.size === 3,
  [...semFamilies].sort().join(", "),
);

const workspace = read("components", "workspace.tsx");
for (const name of ["STATUS_CLASS", "STATUS_DOT"]) {
  const body = block(workspace, name);
  const direct = [
    ...body.matchAll(
      /\b(?:bg|text|border)-(red|orange|sky|violet|amber|rose|emerald|green|yellow)-\d{2,3}\b/g,
    ),
  ].map((m) => m[0]);
  check(
    `${name} красит статус файла токенами, не прямыми цветами`,
    body.length > 0 && direct.length === 0,
    body.length ? direct.join(", ") || "sem-* и accent" : "блок не найден",
  );
}

// ------------------------------- 2. важность и разбор — две независимые шкалы

const colors = read("lib", "review-colors.ts");
const hue = (value) => /\b(?:bg)-([a-z]+)-\d{2,3}\b/.exec(value)?.[1] ?? null;
const entries = (name) =>
  [...block(colors, name).matchAll(/^\s{2}(\w+):\s*"([^"]*)"/gm)].map((m) => [
    m[1],
    m[2],
  ]);

// Нейтральные значения (unset, skip, pending, outdated) в счёт не идут: они
// нарочно без цвета, смысл несёт подпись.
const hues = (name) =>
  entries(name)
    .map(([key, value]) => [key, hue(value)])
    .filter(([, tone]) => tone && tone !== "slate");

const severity = hues("SEVERITY_CHIP");
check(
  "важности с цветом различаются оттенком",
  new Set(severity.map(([, tone]) => tone)).size === severity.length &&
    severity.length >= 3,
  severity.map(([key, tone]) => `${key}: ${tone}`).join(", "),
);

const verdicts = hues("VERDICT_CHIP");
check(
  "итоги разбора различаются оттенком",
  new Set(verdicts.map(([, tone]) => tone)).size === verdicts.length &&
    verdicts.length >= 4,
  verdicts.map(([key, tone]) => `${key}: ${tone}`).join(", "),
);

// «Обсудить» и «Частично верно» стоят рядом в выпадашке: их должен различать
// либо оттенок, либо форма кружка.
const dots = Object.fromEntries(entries("VERDICT_DOT"));
const inner = /discuss:\s*true/.test(colors);
check(
  "«Обсудить» отличимо от «Частично верно»",
  (dots.discuss && dots.partial && hue(dots.discuss) !== hue(dots.partial)) || inner,
  inner ? "цветом и формой (прорезь внутри)" : `${hue(dots.partial)} против ${hue(dots.discuss)}`,
);

// --------------- 3. важность красит клетку «Замечание», не всю строку

const remark = Object.fromEntries(entries("SEVERITY_REMARK"));
const remarkKeys = ["high", "medium", "low"];
check(
  "клетка замечания: блеклая заливка high/medium/low",
  remarkKeys.every((key) => /\bbg-\w+-50\b/.test(remark[key] ?? "")),
  remarkKeys.map((key) => `${key}: ${remark[key] ?? "нет"}`).join(", "),
);
check(
  "клетка замечания: яркая рамка high/medium/low",
  remarkKeys.every((key) => /border-2/.test(remark[key] ?? "")),
  remarkKeys.map((key) => `${key}: ${remark[key] ?? "нет"}`).join(", "),
);
check(
  "итог разбора фон строки не даёт",
  /VERDICT_ROW[^=]*=\s*\{\s*\}/.test(colors),
  "статус читается подписью и кружком",
);

// --------------------------------------- 4. табы этапов на мягком зелёном

const stageTab = block(read("components", "project-stages.tsx"), "STAGE_TAB");
check(
  "табы этапов на мягком зелёном",
  stageTab.includes("emerald") &&
    !/-(sky|violet)-/.test(stageTab) &&
    !/bg-accent/.test(stageTab),
  stageTab ? "" : "STAGE_TAB не найден",
);

// ------------------------- 5. зоны левой колонки разделены толстой рамкой

const strip = read("components", "page-strip.tsx");
const zones = [
  ["проекты", workspace, "border-b-2 border-sky-500"],
  ["разобрано", workspace, "border-t-2 border-amber-500"],
  ["листы в колонке", workspace, "border-t-2 border-emerald-600"],
  ["листы отдельной панелью", strip, "border-r-2 border-emerald-600"],
  ["шапка «Листы»", strip, "border-b-2 border-emerald-600"],
];
for (const [label, source, needle] of zones) {
  check(`зона «${label}» отделена рамкой ${needle}`, source.includes(needle));
}

// ---------------------------------------- 6. оси зафиксированы в документации

const doc = fs.readFileSync(path.resolve("docs", "page-contract.md"), "utf8");
check(
  "оси цвета описаны в docs/page-contract.md",
  /Оси цвета в интерфейсе/.test(doc) &&
    ["--sem-issue", "--sem-ok", "--sem-attn"].every((t) => doc.includes(t)) &&
    /SEVERITY_CHIP/.test(doc) &&
    /SEVERITY_REMARK/.test(doc) &&
    /VERDICT_CHIP/.test(doc),
);
check(
  "зонирование левой колонки описано в docs/page-contract.md",
  /Зоны левой колонки/.test(doc),
);

console.log(failures ? `\nпровалов: ${failures}` : "\nпалитра сведена");
process.exit(failures ? 1 : 0);
