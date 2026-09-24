"use client";

import type { ReactNode, RefObject } from "react";
import { SheetText } from "@/components/sheet-text";
import type { DocumentPage } from "@/types";

export type SheetSearchHit = { pageNumber: number; snippet: string };

/**
 * Правая панель листа: поиск по файлу, полоса замечаний и сама расшифровка.
 * Вынесено из review-pane, поведение не меняется.
 */
export function SheetTextPane({
  paneRef,
  searchRef,
  searchOpen,
  query,
  hits,
  onQueryChange,
  onCloseSearch,
  onGoToPage,
  reviewsBar,
  page,
  pageError,
  filterEmpty,
  filterEmptyText,
  emptyPageText,
  mockNotice,
  highlightQuery,
  focusFirst,
  flagQuotes,
  textLinkOn = false,
  activeBlockId = null,
  onPickText,
  onPickBlock,
  onHoverBlock,
}: {
  paneRef: RefObject<HTMLDivElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  searchOpen: boolean;
  query: string;
  hits: SheetSearchHit[];
  onQueryChange: (value: string) => void;
  onCloseSearch: () => void;
  onGoToPage: (pageNumber: number) => void;
  reviewsBar: ReactNode;
  page?: DocumentPage | null;
  pageError?: string | null;
  /** Под текущий фильтр листов нет — объясняем, а не показываем пустоту. */
  filterEmpty: boolean;
  filterEmptyText: string;
  emptyPageText: string;
  /** Плашка «[MOCK]» — только для служебного режима. */
  mockNotice: boolean;
  highlightQuery: string;
  focusFirst: boolean;
  flagQuotes: string[];
  /** Эксперимент 0102. Выключено — выделение текста ничего не делает. */
  textLinkOn?: boolean;
  activeBlockId?: string | null;
  onPickText?: (text: string) => void;
  onPickBlock?: (blockId: string) => void;
  onHoverBlock?: (blockId: string | null) => void;
}) {
  return (
    <>
      {searchOpen ? (
        <div className="border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Поиск по этому файлу: PSV, 210 кг, позиция…"
              className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={onCloseSearch}
              title="Закрыть поиск (Esc)"
              className="shrink-0 rounded border border-border px-2 py-1 pto-t-md text-muted hover:bg-bg hover:text-text"
            >
              Esc
            </button>
          </div>
          {query.trim().length >= 2 ? (
            hits.length > 0 ? (
              <div className="mt-2 max-h-32 space-y-1 overflow-auto">
                {hits.map((hit) => (
                  <button
                    key={`${hit.pageNumber}-${hit.snippet}`}
                    type="button"
                    onClick={() => onGoToPage(hit.pageNumber)}
                    className="block w-full rounded bg-bg px-2 py-1 text-left pto-t-md hover:bg-accent/10"
                  >
                    <span className="font-medium">Лист {hit.pageNumber}</span>
                    <span className="text-muted"> · {hit.snippet}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-2 pto-t-md text-muted">
                Совпадений в этом файле нет.
              </div>
            )
          ) : null}
        </div>
      ) : null}

      {reviewsBar}

      <div
        ref={paneRef}
        // Заметная полоса и постоянное место под неё — только листу-таблице:
        // на текстовом листе прокручивать нечего, а полоса съедала низ панели.
        onMouseUp={() => {
          if (!textLinkOn || !onPickText) return;
          const selection = window.getSelection();
          const root = paneRef.current;
          if (!selection || !root || !selection.anchorNode) return;
          if (!root.contains(selection.anchorNode)) return;
          const text = selection.toString().replace(/\s+/g, " ").trim();
          if (text.length >= 2) onPickText(text.slice(0, 240));
        }}
        className={`min-h-0 flex-1 overflow-y-auto overscroll-x-contain ${
          page?.kind === "table"
            ? "pto-pane-scroll overflow-x-scroll [scrollbar-gutter:stable]"
            : "overflow-x-auto"
        }`}
      >
        {filterEmpty ? (
          <div className="p-4 text-xs text-muted">{filterEmptyText}</div>
        ) : !page ? (
          <div className="p-4 text-xs text-muted">{emptyPageText}</div>
        ) : (
          <div
            data-sheet-body=""
            className={`markdown-body markdown-body--compact p-3 ${
              page.kind === "table" ? "markdown-body--table" : ""
            }`}
          >
            {pageError ? (
              <div className="mb-2 rounded-md border border-sem-issue-line bg-sem-issue-soft px-2 py-1.5 pto-t-md text-sem-issue-text">
                Ошибка листа: {pageError}
              </div>
            ) : null}
            {mockNotice ? (
              <div className="mb-2 rounded-md border border-sem-attn-line bg-sem-attn-soft px-2 py-1.5 pto-t-md text-sem-attn-text">
                Это ответ режима [MOCK], не работа модели.
              </div>
            ) : null}
            <SheetText
              markdown={page.markdown}
              singlePass={page.kind === "table"}
              highlightQuery={highlightQuery}
              focusFirst={focusFirst}
              flagQuotes={flagQuotes}
              activeBlockId={textLinkOn ? activeBlockId : null}
              onPickBlock={textLinkOn ? onPickBlock : undefined}
              onHoverBlock={textLinkOn ? onHoverBlock : undefined}
            />
          </div>
        )}
      </div>
    </>
  );
}
