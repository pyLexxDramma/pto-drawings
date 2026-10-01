import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  locationLabel,
  normalizeInlineAddresses,
  orderLocations,
  pickLandingLocation,
  remarkWording,
  sheetLabel,
  stampSheetNumber,
  stampSheetTotal,
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

  it("«1 из 3» в полосе — номер листа, «из 3» отдельно", () => {
    assert.equal(stampSheetNumber("1 из 3"), "1");
    assert.equal(stampSheetNumber("1 из 1"), "1");
    assert.equal(stampSheetNumber("6"), "6");
    assert.equal(stampSheetTotal("1 из 3"), "3");
    assert.equal(stampSheetTotal("1 из 1"), "1");
    assert.equal(stampSheetTotal("6"), null);
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
    assert.equal(remarkWording(text), text);
  });

  it("приводит адреса внутри формулировки к одному формату", () => {
    assert.equal(
      normalizeInlineAddresses("118 кВт (лист 6, стр. 1) и 110.2 кВт (стр. 2)"),
      "118 кВт (лист 1, в штампе 6) и 110.2 кВт (лист 2)",
    );
  });

  it("совпадающие номера листа и штампа не удваивает", () => {
    assert.equal(normalizeInlineAddresses("значение (лист 6, стр. 6)"), "значение (лист 6)");
  });

  it("сначала текущий лист, затем остальные по штампу", () => {
    const places = [
      { documentId: "a", pageNumber: 25, stampSheet: "25" },
      { documentId: "a", pageNumber: 22, stampSheet: "22" },
      { documentId: "a", pageNumber: 16, stampSheet: "16" },
    ];
    const ordered = orderLocations(places, { documentId: "a", pageNumber: 22 });
    assert.deepEqual(
      ordered.map((item) => item.pageNumber),
      [22, 16, 25],
    );
    assert.equal(
      pickLandingLocation(places, { documentId: "a", pageNumber: 22 })?.pageNumber,
      22,
    );
  });

  it("без места на текущем листе открывает меньший номер штампа", () => {
    const places = [
      { documentId: "a", pageNumber: 25, stampSheet: "25" },
      { documentId: "a", pageNumber: 3, stampSheet: null },
      { documentId: "a", pageNumber: 16, stampSheet: "16" },
    ];
    assert.equal(
      pickLandingLocation(places, { documentId: "a", pageNumber: 1 })?.pageNumber,
      16,
    );
  });

  it("формулировка для таблицы и выгрузки чистится целиком", () => {
    assert.equal(
      remarkWording(
        "ИОС4-том.pdf, стр. 1: расход задан по-разному (лист 6, стр. 1) и (стр. 2).",
      ),
      "расход задан по-разному (лист 1, в штампе 6) и (лист 2).",
    );
  });
});
