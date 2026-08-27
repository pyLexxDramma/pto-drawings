"use client";

import { useMemo, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { highlightNodes } from "@/lib/highlight-text";
import { parseMarkdownBlocks } from "@/lib/content-sync";
import { markdownSanitizeSchema } from "@/lib/markdown-schema";

type MarkdownViewProps = {
  children: string;
  /** Подсветка совпадений поиска в тексте. */
  highlightQuery?: string;
  /** Блок, синхронизированный скроллом. */
  activeBlockId?: string | null;
  /** Лист-таблица: один Markdown без разбиения на блоки. */
  singlePass?: boolean;
};

function wrapText(
  Tag: "h1" | "h2" | "h3" | "p" | "li" | "td" | "th" | "span",
  children: ReactNode,
  highlightQuery?: string,
  extra?: Record<string, unknown>,
) {
  const body = highlightQuery ? highlightNodes(children, highlightQuery) : children;
  return <Tag {...extra}>{body}</Tag>;
}

function BlockMarkdown({
  source,
  highlightQuery,
}: {
  source: string;
  highlightQuery: string;
}) {
  const q = highlightQuery.trim().length >= 2 ? highlightQuery : "";
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
      components={{
        h1: ({ children: c }) => wrapText("h1", c, q),
        h2: ({ children: c }) => wrapText("h2", c, q),
        h3: ({ children: c }) => wrapText("h3", c, q),
        p: ({ children: c }) => wrapText("p", c, q),
        li: ({ children: c }) => wrapText("li", c, q),
        td: ({ children: c }) => wrapText("td", c, q),
        th: ({ children: c }) => wrapText("th", c, q),
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
  activeBlockId = null,
  singlePass = false,
}: MarkdownViewProps) {
  const blocks = useMemo(
    () => (singlePass ? [] : parseMarkdownBlocks(children)),
    [children, singlePass],
  );
  const q = highlightQuery.trim().length >= 2 ? highlightQuery : "";

  if (!blocks.length) {
    return <BlockMarkdown source={children} highlightQuery={q} />;
  }

  return (
    <>
      {blocks.map((block) => {
        const active = activeBlockId === block.id;
        return (
          <div
            key={block.id}
            data-md-block={block.id}
            data-md-block-active={active ? "true" : undefined}
            className={`scroll-mt-3 -ml-3 rounded-md border-l-2 pl-3 pr-1 transition-colors ${
              active ? "border-accent bg-blue-50/80" : "border-transparent"
            }`}
          >
            <BlockMarkdown source={block.source} highlightQuery={q} />
          </div>
        );
      })}
    </>
  );
}
