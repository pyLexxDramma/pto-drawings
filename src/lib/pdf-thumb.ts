import type { PDFDocumentProxy } from "pdfjs-dist";

export const THUMB_SCALE = 0.22;

export async function renderPdfThumb(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = THUMB_SCALE,
) {
  if (pageNumber > pdf.numPages) return;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext("2d");
  if (!context) return;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
}
