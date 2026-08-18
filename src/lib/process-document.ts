import { extractPageTexts, pageToMarkdown } from "@/lib/extract";
import {
  getDocument,
  readStoredPdf,
  updateDocument,
} from "@/lib/storage";
import type { DocumentPage } from "@/types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const running = new Set<string>();

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
    const pause = process.env.VERCEL ? 0 : 180;

    for (let index = 0; index < texts.length; index += 1) {
      const pageNumber = index + 1;
      const step =
        pageNumber > Math.max(1, Math.floor(texts.length * 0.4))
          ? "drawings"
          : "text";

      await updateDocument(id, {
        status: "processing",
        processingStep: step,
        processingPage: pageNumber,
      });

      pages.push(pageToMarkdown(pageNumber, document.originalName, texts[index]));
      await updateDocument(id, { pages: [...pages] });
      if (pause) await sleep(pause);
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
