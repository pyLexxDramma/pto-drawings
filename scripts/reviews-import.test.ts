import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEngineerRemarks } from "../src/lib/reviews-import.ts";
import { buildXlsx } from "../src/lib/xlsx.ts";
import { readCsvRows, readXlsxRows } from "../src/lib/xlsx-read.ts";

describe("parseEngineerRemarks", () => {
  it("берёт колонку «Замечание» и раздел", () => {
    const rows = [
      ["№", "Раздел", "Замечание", "Важность"],
      ["1", "ОВ", "Диаметр ВСХ-20 не сходится", "высокий"],
      ["2", "", "", ""],
      ["3", "ВК", "Нет аксонометрии", "средний"],
    ];
    const parsed = parseEngineerRemarks(rows);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].section, "ОВ");
    assert.equal(parsed[0].severity, "high");
    assert.equal(parsed[1].text, "Нет аксонометрии");
  });

  it("без шапки читает первый столбец", () => {
    const parsed = parseEngineerRemarks([["Сырое замечание инженера"]]);
    assert.deepEqual(parsed, [
      { text: "Сырое замечание инженера", section: "прочее", severity: "medium" },
    ]);
  });
});

describe("xlsx roundtrip", () => {
  it("читает то, что сам записал", () => {
    const file = buildXlsx({
      name: "Инженер",
      columns: [12, 40],
      rows: [
        [{ value: "Раздел" }, { value: "Замечание" }],
        [{ value: "АР" }, { value: "Площадь КПП" }],
      ],
    });
    const rows = readXlsxRows(new Uint8Array(file));
    const parsed = parseEngineerRemarks(rows);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].section, "АР");
    assert.equal(parsed[0].text, "Площадь КПП");
  });
});

describe("csv", () => {
  it("режет кавычки и точку с запятой", () => {
    const rows = readCsvRows('Замечание;Раздел\n"Нет «узла»";ОВ\n');
    const parsed = parseEngineerRemarks(rows);
    assert.equal(parsed[0].text, "Нет «узла»");
    assert.equal(parsed[0].section, "ОВ");
  });
});
