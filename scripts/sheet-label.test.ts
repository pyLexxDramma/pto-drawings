import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  locationLabel,
  sheetLabel,
  stripAddressPrefix,
} from "../src/lib/sheet-label.ts";
import type { ReviewLocation } from "../src/types.ts";

function loc(patch: Partial<ReviewLocation>): ReviewLocation {
  return {
    documentId: null,
    documentName: "ИОС4-том.pdf",
    pageNumber: 28,
    quote: "",
    ...patch,
  };
}

describe("адрес листа (0097)", () => {
  it("главный номер — лист тома, то есть страница PDF", () => {
    assert.equal(sheetLabel(loc({})), "лист 28");
    assert.equal(locationLabel(loc({})), "ИОС4-том.pdf · лист 28");
  });

  it("номер из штампа идёт справкой в скобках", () => {
    assert.equal(sheetLabel(loc({ stampSheet: "6" })), "лист 28 (в штампе 6)");
  });

  it("совпадающий номер штампа не дублируем", () => {
    assert.equal(sheetLabel(loc({ pageNumber: 6, stampSheet: "6" })), "лист 6");
  });

  it("без номера листа адреса нет", () => {
    assert.equal(sheetLabel(loc({ pageNumber: null })), null);
    assert.equal(locationLabel(loc({ pageNumber: null })), "ИОС4-том.pdf");
  });

  it("срезает адрес из начала формулировки конвейера", () => {
    assert.equal(
      stripAddressPrefix(
        "Северный-квартал-ПЗУ.pdf, стр. 1: «надземных этажей 17» — в задании 16.",
      ),
      "«надземных этажей 17» — в задании 16.",
    );
    assert.equal(
      stripAddressPrefix("лист 6, стр. 1: 118 кВт и 110.2 кВт."),
      "118 кВт и 110.2 кВт.",
    );
  });

  it("не трогает формулировку без адреса", () => {
    const text = "Температурный график задан по-разному: 95/70 и 90/70 °С.";
    assert.equal(stripAddressPrefix(text), text);
  });
});
