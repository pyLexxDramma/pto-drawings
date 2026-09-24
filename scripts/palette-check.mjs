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
 *  4. «вы здесь» показывает подчёркивание accent, а не смысловой цвет;
 *  5. зоны левой колонки разделены толстой нейтральной рамкой — форма охраняет
 *     от клика не в ту зону, цвет для этого занимать нельзя;
 *  6. подсветка листа: место замечания — рамка, поиск — заливка, значение в
 *     расшифровке отличимо от поиска, бесконечных анимаций нет.
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

// ------------------ 4. «вы здесь» — подчёркивание accent, а не смысловой цвет

const stageTab = block(read("components", "project-stages.tsx"), "STAGE_TAB");
check(
  "выбранный таб показан подчёркиванием accent",
  /shadow-\[inset_0_-2px_0_var\(--accent\)\]/.test(stageTab),
  stageTab ? "" : "STAGE_TAB не найден",
);
check(
  "выбранный таб не красится смысловым цветом",
  Boolean(stageTab) && !/-(emerald|sky|violet|amber|rose)-/.test(stageTab),
  "зелёный значит «разобрано» и не может значить заодно «выбрано»",
);

// ------------------- 5. зоны левой колонки: разделены формой, а не смыслом

const strip = read("components", "page-strip.tsx");
const zones = [
  ["проекты", workspace, "border-b-2 border-slate-300", 1],
  ["листы в колонке и «Разобрано»", workspace, "border-t-2 border-slate-300", 2],
  ["листы отдельной панелью", strip, "border-r-2 border-slate-300", 1],
  ["шапка «Листы»", strip, "border-b-2 border-slate-300", 1],
];
for (const [label, source, needle, times] of zones) {
  const found = source.split(needle).length - 1;
  check(
    `зона «${label}» отделена рамкой ${needle}`,
    found >= times,
    `нашлось ${found}, нужно ${times}`,
  );
}
// Зоны делит толщина рамки, и этого хватает. Цвет для них занимать нельзя:
// оттенки уже заняты смыслом (не разобрано, разобрано, важность), и та же
// зелёная рамка вокруг зоны обесценивала зелёный на разобранном листе.
const zoneHue = [
  ...workspace.matchAll(/border-[trbl]-2 border-(?:emerald|amber|sky|rose|violet)-\d{3}/g),
  ...strip.matchAll(/border-[trbl]?-?2 border-(?:emerald|amber|sky|rose|violet)-\d{3}/g),
].map((m) => m[0]);
check(
  "хром зон не красится смысловыми оттенками",
  zoneHue.length === 0,
  zoneHue.join(", ") || "рамки нейтральные",
);

// ------------------------ 6. подсветка: цвет за смыслом, приём отрисовки за ролью

const cssRule = (selector) =>
  new RegExp(`${selector.replace(/[.\\]/g, "\\$&")}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? "";
const token = (name) =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim() ?? "";

const place = cssRule(".pto-place");
const placeAlpha = Number(/\/\s*([\d.]+)\s*\)/.exec(token("--hl-place-soft"))?.[1] ?? "1");
check(
  "место замечания — рамка, а не плотная заливка",
  /outline:\s*2px solid/.test(place) && placeAlpha <= 0.12,
  `заливка ${placeAlpha}, под ней должен читаться чертёж`,
);

// Место и точная цитата внутри него — один факт, значит один цвет. Раньше
// место было зелёным, а цитата внутри оранжевой, и цитата в нём тонула.
const rose = "225 29 72";
check(
  "место и точная цитата внутри него одного цвета",
  token("--hl-place") === "#e11d48" && cssRule(".pto-remark-zone").includes(rose),
  `${token("--hl-place")} и зона на ${rose}`,
);

const find = cssRule(".pto-find");
check(
  "найденное поиском — только заливка, без рамки",
  /background-color/.test(find) && !/outline/.test(find),
  "поиск это навигация, он ничего не оценивает",
);

// Правило .markdown-body mark перебивало .pto-remark-text по специфичности, и
// спорное значение выходило ровно того же цвета, что совпадения поиска.
check(
  "значение замечания в расшифровке отличимо от поиска",
  /\.markdown-body \.pto-remark-text/.test(css) &&
    /inset 0 -2px 0 var\(--hl-place\)/.test(css),
  "красная черта снизу поверх той же песочной заливки",
);

// Бесконечная анимация в боковом зрении тянет взгляд с чертежа. Оставлены
// только две: вертушка ожидания и бегущая полоса загрузки.
const spinners = ["pto-spinner", "pto-progress__bar"];
const infinite = [
  ...css.matchAll(/\.([\w-]+)\s*\{[^}]*animation:[^;]*infinite/g),
].map((m) => m[1]);
check(
  "бесконечно анимированы только вертушка и полоса загрузки",
  infinite.every((name) => spinners.includes(name)),
  infinite.join(", ") || "нет",
);
check(
  "в списке листов нет бесконечной пульсации",
  !/animate-pulse/.test(strip),
  "состояние листа видно цветом и подписью",
);

// ---------------------------------------- 7. оси зафиксированы в документации

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
check(
  "система подсветки описана в docs/page-contract.md",
  /Подсветка/.test(doc) &&
    ["--hl-place", "--hl-alt", "--hl-find"].every((t) => doc.includes(t)) &&
    /HighlightLegend/.test(doc),
);

console.log(failures ? `\nпровалов: ${failures}` : "\nпалитра сведена");
process.exit(failures ? 1 : 0);
