import { extractPageTexts, pageToMarkdown } from "@/lib/extract";
import { getDocument, readStoredPdf, updateDocument } from "@/lib/storage";
import type { DocumentPage } from "@/types";

const running = new Set<string>();

/** Идентификаторы документов, которые реально обрабатываются в этом процессе. */
export function activeDocumentIds() {
  return new Set(running);
}

// Тело документа пишем пачками: иначе каждая страница тянет за собой запись файла.
const PAGE_BATCH = 10;
const BATCH_INTERVAL_MS = 1000;

export async function processDocument(id: string) {
  if (running.has(id)) return;
  running.add(id);

  try {
    const document = await getDocument(id);
    if (!document) return;

    await updateDocument(id, {
      status: "processing",
      processingStep: "text",
      processingPage: 1,
      errorMessage: null,
    });

    const buffer = await readStoredPdf(document.storedName);
    const texts = await extractPageTexts(buffer);
    const pages: DocumentPage[] = [];
    const drawingsFrom = Math.max(1, Math.floor(texts.length * 0.4));
    let lastFlush = Date.now();
    let pendingSince = 0;

    for (let index = 0; index < texts.length; index += 1) {
      const pageNumber = index + 1;
      pages.push(pageToMarkdown(pageNumber, document.originalName, texts[index]));
      pendingSince += 1;

      const isLast = pageNumber === texts.length;
      const dueByCount = pendingSince >= PAGE_BATCH;
      const dueByTime = Date.now() - lastFlush >= BATCH_INTERVAL_MS;

      if (isLast || dueByCount || dueByTime) {
        await updateDocument(id, {
          status: "processing",
          processingStep: pageNumber > drawingsFrom ? "drawings" : "text",
          processingPage: pageNumber,
          pages: [...pages],
        });
        pendingSince = 0;
        lastFlush = Date.now();
      }
    }

    await updateDocument(id, {
      status: "done",
      processingStep: "done",
      processingPage: null,
      pageCount: pages.length || document.pageCount,
      pages,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось обработать файл";
    await updateDocument(id, {
      status: "error",
      processingStep: null,
      processingPage: null,
      errorMessage: message,
    });
  } finally {
    running.delete(id);
  }
}
