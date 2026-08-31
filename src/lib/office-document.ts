import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import type { DocumentPage } from "@/types";

const PAGE_CHARS = 4500;

/** Текст из .doc / .docx → страницы markdown для расшифровки. */
export async function pagesFromOfficeFile(
  buffer: Buffer,
  ext: "doc" | "docx",
  originalName: string,
): Promise<DocumentPage[]> {
  const text = (await extractOfficeText(buffer, ext)).replace(/\r\n/g, "\n").trim();
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
        "Текст извлечён из Word (.doc/.docx), без конвейера PDF/модели.",
      ],
      numbers: null,
    };
  });
}

async function extractOfficeText(
  buffer: Buffer,
  ext: "doc" | "docx",
): Promise<string> {
  if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? "";
  }
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
