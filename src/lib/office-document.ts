import WordExtractor from "word-extractor";
import type { DocumentPage } from "@/types";

const PAGE_CHARS = 4500;

/** Текст из старого .doc → страницы markdown (без конвейера). .docx идёт в POST /jobs. */
export async function pagesFromOfficeFile(
  buffer: Buffer,
  ext: "doc",
  originalName: string,
): Promise<DocumentPage[]> {
  const text = (await extractOfficeText(buffer)).replace(/\r\n/g, "\n").trim();
  if (!text) {
    throw Object.assign(
      new Error("В файле Word нет текста для расшифровки"),
      { status: 400 },
    );
  }

  const chunks = splitOfficeText(text);
  return chunks.map((chunk, index) => {
    const pageNumber = index + 1;
    const markdown =
      chunks.length > 1
        ? `# ${originalName} · часть ${pageNumber}\n\n${chunk}`
        : `# ${originalName}\n\n${chunk}`;
    return {
      pageNumber,
      kind: "text" as const,
      markdown,
      extractedText: chunk,
      source: "heuristic" as const,
      warnings: [
        "Старый формат .doc разобран на фронте. Для таблиц и сводки комплекта сохраните файл как .docx.",
      ],
      numbers: null,
    };
  });
}

async function extractOfficeText(buffer: Buffer): Promise<string> {
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buffer);
  return [doc.getBody(), doc.getHeaders(), doc.getFooters()]
    .filter((part) => typeof part === "string" && part.trim())
    .join("\n\n");
}

function splitOfficeText(text: string): string[] {
  const byBreak = text
    .split(/\f+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (byBreak.length > 1) return byBreak;

  if (text.length <= PAGE_CHARS) return [text];

  const parts: string[] = [];
  let rest = text;
  while (rest.length > PAGE_CHARS) {
    let cut = rest.lastIndexOf("\n\n", PAGE_CHARS);
    if (cut < PAGE_CHARS * 0.4) cut = rest.lastIndexOf("\n", PAGE_CHARS);
    if (cut < PAGE_CHARS * 0.4) cut = PAGE_CHARS;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.length ? parts : [text];
}
