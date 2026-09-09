import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zipSync, strToU8 } from "fflate";
import {
  asDrawingKit,
  extractDrawingFilesFromZip,
} from "../src/lib/drawing-kit.ts";

function zip(files: Record<string, string>): Buffer {
  const entries = Object.fromEntries(
    Object.entries(files).map(([name, body]) => [name, strToU8(body)]),
  );
  return Buffer.from(zipSync(entries));
}

describe("extractDrawingFilesFromZip", () => {
  it("берёт из архива все чертежи, а не один", () => {
    const entries = extractDrawingFilesFromZip(
      zip({
        "Лист 2.pdf": "%PDF-1.4 два",
        "Лист 1.pdf": "%PDF-1.4 один",
        "Лист 3.dwg": "dwg",
        "readme.txt": "мимо",
      }),
    );
    assert.deepEqual(
      entries.map((item) => item.name),
      ["Лист 1.pdf", "Лист 2.pdf", "Лист 3.dwg"],
    );
  });

  it("пропускает служебные файлы macOS и пустые записи", () => {
    const entries = extractDrawingFilesFromZip(
      zip({
        "__MACOSX/._Лист.pdf": "мусор",
        "._Лист.pdf": "мусор",
        "Лист.pdf": "%PDF-1.4",
        "Пусто.pdf": "",
      }),
    );
    assert.deepEqual(
      entries.map((item) => item.name),
      ["Лист.pdf"],
    );
  });

  it("ругается, только если чертежей нет совсем", () => {
    assert.throws(
      () => extractDrawingFilesFromZip(zip({ "readme.txt": "мимо" })),
      /нет PDF/,
    );
  });
});

describe("asDrawingKit", () => {
  it("пара PDF + DWG — комплект", () => {
    const kit = asDrawingKit(
      extractDrawingFilesFromZip(
        zip({ "Лист.pdf": "%PDF-1.4", "Лист.dwg": "dwg" }),
      ),
    );
    assert.equal(kit?.pdf.name, "Лист.pdf");
    assert.equal(kit?.cad.ext, "dwg");
  });

  it("пачка файлов комплектом не считается", () => {
    const entries = extractDrawingFilesFromZip(
      zip({ "Лист 1.pdf": "%PDF-1.4", "Лист 2.pdf": "%PDF-1.4" }),
    );
    assert.equal(asDrawingKit(entries), null);
  });
});
