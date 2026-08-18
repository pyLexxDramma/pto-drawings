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

  const drawingHint =
    /PLAN|ELEVATION|SECTION|DETAIL|SCALE:|ПЛАН|ФАСАД|РАЗРЕЗ|УЗЕЛ|ЧЕРТЕЖ/i.test(
      text,
    );
  const avg = text.length / Math.max(lines.length, 1);
  if (drawingHint || (avg < 48 && lines.length > 10)) return "drawing";

  const splitLines = lines.filter(
    (line) => line.includes("\t") || / {2,}/.test(line) || /\|/.test(line),
  );
  if (lines.length >= 4 && splitLines.length >= Math.ceil(lines.length * 0.35)) {
    return "table";
  }
  if (text.length > 200 && splitLines.length >= 2) return "mixed";
  return "text";
}

function escapeMd(line: string) {
  return line.replace(/\|/g, "\\|");
}

function toTable(text: string) {
  const rows = linesOf(text)
    .map((line) =>
      line
        .split(/\t+| {2,}|\s*\|\s*/)
        .map((cell) => cell.trim())
        .filter(Boolean),
    )
    .filter((row) => row.length > 0);

  if (rows.length === 0) return textToMarkdownList(text);
  const cols = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [
    ...row,
    ...Array.from({ length: cols - row.length }, () => ""),
  ]);
  const format = (row: string[]) =>
    `| ${row.map((cell) => escapeMd(cell)).join(" | ")} |`;
  const header = normalized[0];
  const separator = `| ${header.map(() => "---").join(" | ")} |`;
  return [format(header), separator, ...normalized.slice(1).map(format)].join(
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

export function pageToMarkdown(
  pageNumber: number,
  fileName: string,
  text: string,
): DocumentPage {
  const kind = classify(text);
  const extractedText = text;
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
      markdown: [
        ...header,
        `**Тип листа:** таблица`,
        "",
        "## Таблица",
        "",
        toTable(text),
      ].join("\n"),
    };
  }

  if (kind === "drawing" || kind === "mixed") {
    return {
      pageNumber,
      kind: kind === "mixed" ? "mixed" : "drawing",
      extractedText,
      markdown: [
        ...header,
        `**Тип листа:** чертёж`,
        "",
        "## Обозначения и подписи",
        "",
        textToMarkdownList(text),
        "",
        "## Описание чертежа",
        "",
        "_Связное описание листа — как его объяснил бы инженер. На следующем этапе его пишет модель._",
        "",
        "- Что изображено:",
        "- Позиции, выноски, марки:",
        "- Связи и направления:",
        "- Размеры и примечания:",
      ].join("\n"),
    };
  }

  return {
    pageNumber,
    kind,
    extractedText,
    markdown: [
      ...header,
      `**Тип листа:** текст`,
      "",
      "## Содержание",
      "",
      paragraphsToMarkdown(text),
    ].join("\n"),
  };
}
