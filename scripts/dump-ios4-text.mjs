/** Текстовый слой исходного листа ИОС4-28: величины и свободное место. */
import { readFileSync } from "node:fs";

const src = process.argv[2];
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(src)),
  useSystemFonts: true,
}).promise;

console.log("страниц:", doc.numPages);
for (let n = 1; n <= doc.numPages; n += 1) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  console.log(`\n=== стр.${n} ${Math.round(vp.width)}x${Math.round(vp.height)} pt`);
  const content = await page.getTextContent();
  const items = content.items
    .filter((item) => (item.str || "").trim())
    .map((item) => ({
      text: item.str.trim(),
      x: Math.round(item.transform[4]),
      y: Math.round(item.transform[5]),
    }));
  for (const item of items) console.log(`${item.x}\t${item.y}\t${item.text}`);
}
