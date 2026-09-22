"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownView } from "@/components/markdown-view";
import {
  parseMarkdownBlocks,
  splitMarkdownSections,
} from "@/lib/content-sync";
import type { FocusHighlightState } from "@/lib/highlight-text";

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
  const sections = useMemo(() => splitMarkdownSections(markdown), [markdown]);

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

  const q = highlightQuery.trim().length >= 2 ? highlightQuery : "";
  // Один state якоря на весь лист: иначе в каждой секции замигает своё «первое»
  // совпадение и инженер не поймёт, куда смотреть.
  const focusState: FocusHighlightState | null =
    focusFirst && q ? { focusStyle: true, anchorLeft: true } : null;

  const titled = sections.filter((section) => section.title);

  return (
    <>
      {titled.length > 1 ? <SheetToc sections={titled} /> : null}
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
        const expanded = open[section.id] ?? !section.service;
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
                className="flex min-w-0 items-center gap-1.5 text-left hover:text-accent"
              >
                <span className="shrink-0 pto-t-sm text-muted">
                  {expanded ? "▾" : "▸"}
                </span>
                <span className="min-w-0">{section.title}</span>
                {!expanded ? (
                  <span className="shrink-0 rounded border border-border px-1 pto-t-xs font-normal text-muted">
                    свёрнуто
                  </span>
                ) : null}
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

/** Оглавление листа: куда прыгать, не прокручивая ведомость целиком. */
function SheetToc({
  sections,
}: {
  sections: Array<{ id: string; title: string; service: boolean }>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={hostRef}
      className="mb-2 flex flex-wrap items-center gap-1 border-b border-border pb-2"
      data-sheet-toc=""
    >
      <span className="pto-t-sm text-muted">На листе:</span>
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => {
            const target = hostRef.current
              ?.closest("[data-sheet-body]")
              ?.querySelector(`#${section.id}`);
            target?.scrollIntoView({ block: "start", behavior: "smooth" });
          }}
          className={`max-w-[18rem] truncate rounded border px-1.5 py-0.5 pto-t-sm ${
            section.service
              ? "border-dashed border-slate-300 text-muted hover:bg-bg"
              : "border-border bg-white text-text hover:border-accent hover:text-accent"
          }`}
          title={section.title}
        >
          {section.title}
        </button>
      ))}
    </div>
  );
}
