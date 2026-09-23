import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findQuoteRanges,
  preferHighlightQuery,
  remarkTermsInMarkdown,
  stripMarkdownMarks,
} from "../src/lib/highlight-text.tsx";

/**
 * Баг 0094: на листе без текстового слоя конвейер берёт цитату из расшифровки,
 * а она размечена — приезжают `**` и `_`. Подсветка обязана их не замечать.
 */
describe("цитата с разметкой расшифровки", () => {
  const markdown =
    "**ЧТО ЭТО:** Схема узла подключения: принята **250 кВт**, а по расчёту нагрузок _180 кВт_.";

  it("снимает знаки разметки из строки", () => {
    assert.equal(stripMarkdownMarks("**250 кВт**"), "250 кВт");
    assert.equal(stripMarkdownMarks("_Описание собрано по картинке_"), "Описание собрано по картинке");
  });

  it("находит цитату, в которой конвейер оставил звёздочки", () => {
    assert.ok(findQuoteRanges(markdown, "принята **250 кВт**").length > 0);
    assert.ok(findQuoteRanges("принята 250 кВт, а по расчёту 180", "**250 кВт**").length > 0);
  });

  it("находит чистую цитату там, где разметка стоит внутри фразы", () => {
    assert.ok(findQuoteRanges(markdown, "принята 250 кВт, а по расчёту нагрузок 180 кВт").length > 0);
    assert.ok(findQuoteRanges(markdown, "ЧТО ЭТО: Схема узла подключения").length > 0);
  });

  it("не выдумывает совпадений там, где фразы нет", () => {
    assert.equal(findQuoteRanges(markdown, "система дымоудаления").length, 0);
  });

  it("предпочитает фразу, найденную в размеченной расшифровке", () => {
    assert.equal(
      preferHighlightQuery("Схема узла подключения", markdown),
      "Схема узла подключения",
    );
  });

  it("берёт термины замечания из размеченной расшифровки", () => {
    const terms = remarkTermsInMarkdown(markdown, [
      { text: "Принята 250 кВт вместо 180 кВт", quotes: ["принята **250 кВт**"] },
    ]);
    assert.ok(terms.some((term) => /250/.test(term)), terms.join(" | "));
  });
});
