import { extractText, getDocumentProxy } from "unpdf";
import type { DocumentPage, PageKind } from "@/types";

export async function extractPageTexts(buffer: Buffer): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const result = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(result.text) ? result.text : [result.text];
  return pages.map((page) => (page ?? "").replace(/\r/g, "").trim());
}

function linesOf(text: string) {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isTitle(line: string) {
  if (line.length < 6 || line.length > 90) return false;
  const letters = line.replace(/[^A-Za-zА-Яа-яЁё]/g, "");
  if (letters.length < 4) return false;
  return (
    letters === letters.toUpperCase() &&
    /PLAN|ELEVATION|SECTION|DETAIL|NOTES|SCHEDULE|ПЛАН|ФАСАД|РАЗРЕЗ|УЗЕЛ|ЧЕРТЕЖ|ТАБЛИЦА/i.test(
      line,
    )
  );
}

function classify(text: string): PageKind {
  const lines = linesOf(text);
  if (lines.length === 0 || text.length < 140) return "drawing";

  const splitLines = lines.filter(
    (line) => line.includes("\t") || / {2,}/.test(line) || /\|/.test(line),
  );
  // Таблицы раньше эвристики «короткие строки = чертёж»
  if (lines.length >= 4 && splitLines.length >= Math.ceil(lines.length * 0.35)) {
    return "table";
  }

  const drawingHint =
    /\bPLAN\b|\bELEVATION\b|\bSECTION\b|\bDETAIL\b|SCALE:|ПЛАН|ФАСАД|РАЗРЕЗ|УЗЕЛ|ЧЕРТЕЖ/i.test(
      text,
    );
  if (drawingHint) return "drawing";

  // Короткие выноски чертежа — не путать с абзацами пояснительной записки
  const avg = text.length / Math.max(lines.length, 1);
  if (text.length < 500 && avg < 48 && lines.length > 10) return "drawing";

  if (text.length > 200 && splitLines.length >= 2) return "mixed";
  return "text";
}

function escapeMd(line: string) {
  return line.replace(/\|/g, "\\|");
}

function isDashOnly(line: string) {
  const compact = line.replace(/\s+/g, "");
  return compact.length >= 8 && /^[\-|—–_=]+$/.test(compact);
}

function splitCells(line: string) {
  return line
    .split(/\t+| {2,}|\s*\|\s*/)
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function toTable(text: string) {
  const preamble: string[] = [];
  const candidates: string[][] = [];

  for (const line of linesOf(text)) {
    if (isDashOnly(line)) continue;
    const cells = splitCells(line);
    if (cells.length === 0) continue;
    // Заголовок/подзаголовок ведомости (одна-две ячейки) — над таблицей
    if (cells.length < 3) {
      if (candidates.length === 0) preamble.push(cells.join(" — "));
      continue;
    }
    candidates.push(cells);
  }

  if (candidates.length === 0) return textToMarkdownList(text);

  let headerIdx = candidates.findIndex(
    (row) =>
      /^(поз\.?|pos\.?|№|no\.?)$/i.test(row[0] ?? "") ||
      row.some((cell) => /^(поз\.?|обозначение|наименование)$/i.test(cell)),
  );
  if (headerIdx < 0) headerIdx = 0;

  for (const row of candidates.slice(0, headerIdx)) {
    preamble.push(row.join(" — "));
  }

  const rows = candidates.slice(headerIdx);
  const cols = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [
    ...row,
    ...Array.from({ length: cols - row.length }, () => ""),
  ]);
  const format = (row: string[]) =>
    `| ${row.map((cell) => escapeMd(cell)).join(" | ")} |`;
  const header = normalized[0];
  const separator = `| ${header.map(() => "---").join(" | ")} |`;
  const table = [format(header), separator, ...normalized.slice(1).map(format)].join(
    "\n",
  );

  if (preamble.length === 0) return table;
  return [`**${preamble[0]}**`, ...preamble.slice(1).map((line) => `_${line}_`), "", table].join(
    "\n",
  );
}

function textToMarkdownList(text: string) {
  const lines = linesOf(text);
  if (lines.length === 0) {
    return "_С листа почти не удалось вытащить текст._";
  }

  const blocks: string[] = [];
  for (const line of lines) {
    if (isTitle(line)) {
      blocks.push("", `## ${line}`, "");
      continue;
    }
    blocks.push(`- ${escapeMd(line)}`);
  }
  return blocks.join("\n").trim();
}

function paragraphsToMarkdown(text: string) {
  const chunks = text
    .split(/\n{2,}/)
    .map((chunk) => chunk.replace(/\n/g, " ").trim())
    .filter(Boolean);

  if (chunks.length <= 1) return textToMarkdownList(text);
  return chunks.map((chunk) => chunk).join("\n\n");
}

function warningsFor(text: string, kind: PageKind) {
  const warnings: string[] = [];
  if (text.trim().length < 40) {
    warnings.push("С листа почти не извлёкся текст — вероятно, нужен OCR.");
  }
  if (kind === "table" && !/\|/.test(text) && !/\t/.test(text)) {
    warnings.push("Границы таблицы восстановлены по отступам — проверьте ячейки.");
  }
  return warnings;
}

export function pageToMarkdown(
  pageNumber: number,
  fileName: string,
  text: string,
): DocumentPage {
  const kind = classify(text);
  const extractedText = text;
  const source = "heuristic" as const;
  const warnings = warningsFor(text, kind);
  const header = [
    `# Лист ${pageNumber}`,
    "",
    `**Файл:** \`${fileName}\``,
    "",
  ];

  if (kind === "table") {
    return {
      pageNumber,
      kind,
      extractedText,
      source,
      warnings,
      markdown: [
        ...header,
        `**Тип листа:** таблица`,
        "",
        "## Таблица (извлечено автоматически)",
        "",
        toTable(text),
        "",
        "## Что дальше",
        "",
        "- **ИИ-помощник** (когда подключим): сверит строки с чертежом, предложит недостающие позиции и единицы.",
        "- **Инженер:** правит ячейки кнопкой «Исправить», подтверждает спорные строки.",
      ].join("\n"),
    };
  }

  if (kind === "drawing" || kind === "mixed") {
    return {
      pageNumber,
      kind: kind === "mixed" ? "mixed" : "drawing",
      extractedText,
      source,
      warnings,
      markdown: [
        ...header,
        `**Тип листа:** чертёж`,
        "",
        "## Обозначения и подписи (извлечено автоматически)",
        "",
        textToMarkdownList(text),
        "",
        "## Описание листа — заполнит ИИ-помощник",
        "",
        "_Пока заглушка. После подключения модели сюда попадёт связное описание._",
        "",
        "- Что изображено:",
        "- Позиции, выноски, марки:",
        "- Связи и направления:",
        "- Размеры и примечания:",
        "",
        "## Правки инженера",
        "",
        "_Инженер дополняет и исправляет текст через «Исправить»; правки пишутся в журнал._",
      ].join("\n"),
    };
  }

  return {
    pageNumber,
    kind,
    extractedText,
    source,
    warnings,
    markdown: [
      ...header,
      `**Тип листа:** текст`,
      "",
      "## Содержание (извлечено автоматически)",
      "",
      paragraphsToMarkdown(text),
      "",
      "## Что дальше",
      "",
      "- **ИИ-помощник:** сжатие, проверка полноты, ссылки на связанные листы комплекта.",
      "- **Инженер:** правка формулировок и норм через «Исправить».",
    ].join("\n"),
  };
}
