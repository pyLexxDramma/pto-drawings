"use client";

import { useMemo, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import {
  flagNodes,
  highlightNodesShared,
  type FocusHighlightState,
} from "@/lib/highlight-text";
import { parseMarkdownBlocks } from "@/lib/content-sync";
import { markdownSanitizeSchema } from "@/lib/markdown-schema";

type MarkdownViewProps = {
  children: string;
  /** Подсветка совпадений поиска в тексте. */
  highlightQuery?: string;
  /** Цитаты из таблицы замечаний по этому листу — красная подсветка мест. */
  flagQuotes?: string[];
  /** Первое совпадение highlightQuery — якорь scroll (Где в ПД). */
  focusFirst?: boolean;
  /** Лист-таблица: один Markdown без разбиения на блоки. */
  singlePass?: boolean;
};

function wrapText(
  Tag: "h1" | "h2" | "h3" | "p" | "li" | "td" | "th" | "span",
  children: ReactNode,
  highlightQuery: string,
  flagQuotes: string[],
  focusState: FocusHighlightState | null,
  extra?: Record<string, unknown>,
) {
  // Сначала якорь замечания (мигание), потом остальные цитаты листа.
  const highlighted =
    highlightQuery && focusState
      ? highlightNodesShared(children, highlightQuery, focusState)
      : highlightQuery
        ? highlightNodesShared(children, highlightQuery, {
            focusStyle: false,
            anchorLeft: false,
          })
        : children;
  const body = flagQuotes.length
    ? flagNodes(highlighted, flagQuotes)
    : highlighted;
  return <Tag {...extra}>{body}</Tag>;
}

function BlockMarkdown({
  source,
  highlightQuery,
  flagQuotes,
  focusState,
}: {
  source: string;
  highlightQuery: string;
  flagQuotes: string[];
  focusState: FocusHighlightState | null;
}) {
  const q = highlightQuery.trim().length >= 2 ? highlightQuery : "";
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
      components={{
        h1: ({ children: c }) => wrapText("h1", c, q, flagQuotes, focusState),
        h2: ({ children: c }) => wrapText("h2", c, q, flagQuotes, focusState),
        h3: ({ children: c }) => wrapText("h3", c, q, flagQuotes, focusState),
        p: ({ children: c }) => wrapText("p", c, q, flagQuotes, focusState),
        li: ({ children: c }) => wrapText("li", c, q, flagQuotes, focusState),
        table: ({ children: c }) => (
          <table
            onMouseOver={(event) => {
              const cell = (event.target as HTMLElement).closest("td,th");
              const table = event.currentTarget;
              table
                .querySelectorAll(".pto-col-hover")
                .forEach((node) => node.classList.remove("pto-col-hover"));
              if (!cell) return;
              const index = (cell as HTMLTableCellElement).cellIndex;
              for (const row of Array.from(table.rows)) {
                row.cells[index]?.classList.add("pto-col-hover");
              }
            }}
            onMouseLeave={(event) => {
              event.currentTarget
                .querySelectorAll(".pto-col-hover")
                .forEach((node) => node.classList.remove("pto-col-hover"));
            }}
          >
            {c}
          </table>
        ),
        td: ({ children: c }) => wrapText("td", c, q, flagQuotes, focusState),
        th: ({ children: c }) => wrapText("th", c, q, flagQuotes, focusState),
      }}
    >
      {source}
    </Markdown>
  );
}

/** Единственное место, где markdown листа превращается в HTML. */
export function MarkdownView({
  children,
  highlightQuery = "",
  flagQuotes = [],
  focusFirst = false,
  singlePass = false,
}: MarkdownViewProps) {
  const blocks = useMemo(
    () => (singlePass ? [] : parseMarkdownBlocks(children)),
    [children, singlePass],
  );
  const q = highlightQuery.trim().length >= 2 ? highlightQuery : "";
  // Новый state на каждый render: highlightNodes сбрасывает anchor при обходе.
  const focusState: FocusHighlightState | null =
    focusFirst && q ? { focusStyle: true, anchorLeft: true } : null;

  if (!blocks.length) {
    return (
      <BlockMarkdown
        source={children}
        highlightQuery={q}
        flagQuotes={flagQuotes}
        focusState={focusState}
      />
    );
  }

  return (
    <>
      {blocks.map((block) => (
        <div key={block.id} className="scroll-mt-3">
          <BlockMarkdown
            source={block.source}
            highlightQuery={q}
            flagQuotes={flagQuotes}
            focusState={focusState}
          />
        </div>
      ))}
    </>
  );
}
