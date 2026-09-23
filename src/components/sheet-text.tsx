"use client";

import { useEffect, useMemo, useState } from "react";
import { MarkdownView } from "@/components/markdown-view";
import {
  omitEmptyPlacement,
  parseMarkdownBlocks,
  splitMarkdownSections,
  tidyVerbatim,
} from "@/lib/content-sync";
import { findQuoteRanges, type FocusHighlightState } from "@/lib/highlight-text";

type SheetTextProps = {
  markdown: string;
  /** Лист-таблица: режем на секции, но тело секции рендерим одним куском. */
  singlePass?: boolean;
  highlightQuery?: string;
  flagQuotes?: string[];
  focusFirst?: boolean;
};

/**
 * Лист расшифровки по разделам. До этого лист был одной простынёй: служебные
 * блоки конвейера («Состав листа», «Описание чертежа») занимали первый экран,
 * заголовки уезжали при прокрутке ведомости, а перейти к штампу было нечем.
 */
export function SheetText({
  markdown,
  singlePass = false,
  highlightQuery = "",
  flagQuotes = [],
  focusFirst = false,
}: SheetTextProps) {
  const sections = useMemo(
    () =>
      splitMarkdownSections(markdown).map((section) => {
        const body = omitEmptyPlacement(section.body);
        return /дословно/i.test(section.title)
          ? { ...section, body: tidyVerbatim(body) }
          : { ...section, body };
      }),
    [markdown],
  );

  /**
   * Смещения нумерации блоков: id должны быть уникальны на весь лист, а
   * parseMarkdownBlocks нумерует с нуля внутри каждого переданного куска.
   */
  const offsets = useMemo(() => {
    const out: number[] = [];
    let total = 0;
    for (const section of sections) {
      out.push(total);
      total += parseMarkdownBlocks(section.body).length;
    }
    return out;
  }, [sections]);

  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Новый лист — сворачиваем служебное заново, иначе состояние течёт между листами.
  useEffect(() => {
    setOpen({});
  }, [markdown]);

  /**
   * Раздел с искомой цитатой разворачиваем сам, даже служебный. У находок со
   * сканов цитата живёт в «Описании чертежа (модель, по изображению)» — оно
   * служебное и свёрнуто, и инженер видел «в расшифровке совпадения нет» при
   * том, что текст на листе есть (0094).
   */
  const focusSections = useMemo(() => {
    const needle = highlightQuery.trim();
    if (needle.length < 2) return new Set<string>();
    const hit = new Set<string>();
    for (const section of sections) {
      if (findQuoteRanges(section.body, needle).length > 0) hit.add(section.id);
    }
    return hit;
  }, [sections, highlightQuery]);

  const q = highlightQuery.trim().length >= 2 ? highlightQuery : "";
  // Стиль замечания на весь лист: цель прокрутки — первое совпадение в
  // документе, поэтому секциям нечего делить между собой.
  const focusState: FocusHighlightState | null = focusFirst && q ? { focusStyle: true } : null;

  return (
    <>
      {sections.map((section, index) => {
        if (!section.title) {
          return (
            <MarkdownView
              key={section.id}
              singlePass={singlePass}
              highlightQuery={q}
              flagQuotes={flagQuotes}
              sharedFocusState={focusState}
              blockIdOffset={offsets[index]}
            >
              {section.body}
            </MarkdownView>
          );
        }

        // Служебное свёрнуто, пока инженер сам не откроет: это отладка конвейера,
        // и роль тут не при чём — админ читает лист так же, как остальные.
        const expanded =
          open[section.id] ?? (!section.service || focusSections.has(section.id));
        return (
          <section key={section.id} id={section.id} className="scroll-mt-10">
            <h2
              className="sheet-section-head flex items-center gap-1.5"
              data-sheet-section={section.service ? "service" : "content"}
            >
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() =>
                  setOpen((prev) => ({ ...prev, [section.id]: !expanded }))
                }
                className="flex min-w-0 items-center gap-2 text-left hover:text-accent"
              >
                <span className="shrink-0 text-lg font-bold leading-none">
                  {expanded ? "▾" : "▸"}
                </span>
                <span className="min-w-0 text-base font-bold">{section.title}</span>
              </button>
            </h2>
            {expanded ? (
              <MarkdownView
                singlePass={singlePass}
                highlightQuery={q}
                flagQuotes={flagQuotes}
                sharedFocusState={focusState}
                blockIdOffset={offsets[index]}
              >
                {section.body}
              </MarkdownView>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
