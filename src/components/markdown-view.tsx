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
  /** Клик по заголовку / номеру листа — якорь к PDF. */
  onAnchor?: (payload: { text: string; pageHint: number | null }) => void;
  /** Подсветка совпадений поиска в тексте. */
  highlightQuery?: string;
  /** Блок, синхронизированный скроллом. */
  activeBlockId?: string | null;
  /** Блок под курсором (только в режиме подсветки). */
  hoverBlockId?: string | null;
  /** Выбранный кликом блок (режим подсветки). */
  selectedBlockId?: string | null;
  /** Режим подсветки строка ↔ участок. */
  highlightMode?: boolean;
  onHoverBlock?: (blockId: string | null) => void;
  onSelectBlock?: (blockId: string | null) => void;
  /** Лист-таблица: один Markdown без разбиения на блоки. */
  singlePass?: boolean;
};

function pageHintFromText(text: string): number | null {
  const match = text.match(/(?:лист|стр\.?|page)\s*[:№#]?\s*(\d{1,4})/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function AnchorHeading({
  tag: Tag,
  children,
  onAnchor,
  highlightQuery,
}: {
  tag: "h1" | "h2" | "h3";
  children: ReactNode;
  onAnchor?: MarkdownViewProps["onAnchor"];
  highlightQuery?: string;
}) {
  const text = flattenText(children);
  const body = highlightQuery ? highlightNodes(children, highlightQuery) : children;
  return (
    <Tag>
      <button
        type="button"
        className="cursor-pointer text-left hover:text-accent hover:underline"
        title="Показать на чертеже"
        onClick={() => onAnchor?.({ text, pageHint: pageHintFromText(text) })}
      >
        {body}
      </button>
    </Tag>
  );
}

function flattenText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return flattenText(props?.children);
  }
  return "";
}

function wrapText(
  Tag: "p" | "li" | "td" | "th" | "span",
  children: ReactNode,
  highlightQuery?: string,
  extra?: Record<string, unknown>,
) {
  const body = highlightQuery ? highlightNodes(children, highlightQuery) : children;
  return <Tag {...extra}>{body}</Tag>;
}

function BlockMarkdown({
  source,
  onAnchor,
  highlightQuery,
}: {
  source: string;
  onAnchor?: MarkdownViewProps["onAnchor"];
  highlightQuery: string;
}) {
  const q = highlightQuery.trim().length >= 2 ? highlightQuery : "";
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
      components={{
        h1: ({ children: c }) => (
          <AnchorHeading tag="h1" onAnchor={onAnchor} highlightQuery={q}>
            {c}
          </AnchorHeading>
        ),
        h2: ({ children: c }) => (
          <AnchorHeading tag="h2" onAnchor={onAnchor} highlightQuery={q}>
            {c}
          </AnchorHeading>
        ),
        h3: ({ children: c }) => (
          <AnchorHeading tag="h3" onAnchor={onAnchor} highlightQuery={q}>
            {c}
          </AnchorHeading>
        ),
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
  onAnchor,
  highlightQuery = "",
  activeBlockId = null,
  hoverBlockId = null,
  selectedBlockId = null,
  highlightMode = false,
  onHoverBlock,
  onSelectBlock,
  singlePass = false,
}: MarkdownViewProps) {
  const blocks = useMemo(
    () => (singlePass ? [] : parseMarkdownBlocks(children)),
    [children, singlePass],
  );
  const q = highlightQuery.trim().length >= 2 ? highlightQuery : "";

  if (!blocks.length) {
    return (
      <BlockMarkdown source={children} onAnchor={onAnchor} highlightQuery={q} />
    );
  }

  return (
    <>
      {blocks.map((block) => {
        const hovered = highlightMode && hoverBlockId === block.id;
        const selected = highlightMode && selectedBlockId === block.id;
        const active = activeBlockId === block.id;
        const lit = selected || hovered;
        return (
          <div
            key={block.id}
            data-md-block={block.id}
            data-md-block-active={active ? "true" : undefined}
            data-md-block-hover={hovered ? "true" : undefined}
            data-md-block-selected={selected ? "true" : undefined}
            onMouseEnter={() => {
              if (highlightMode) onHoverBlock?.(block.id);
            }}
            onMouseLeave={() => {
              if (highlightMode) onHoverBlock?.(null);
            }}
            onClick={(event) => {
              if (!highlightMode || !onSelectBlock) return;
              event.preventDefault();
              onSelectBlock(selected ? null : block.id);
            }}
            className={`scroll-mt-3 -ml-3 rounded-md border-l-2 pl-3 pr-1 transition-colors ${
              lit
                ? "border-emerald-600 bg-emerald-100/95 shadow-[inset_0_0_0_1px_rgba(5,150,105,0.25)]"
                : active
                  ? "border-accent bg-blue-50/80"
                  : highlightMode
                    ? "cursor-pointer border-transparent hover:border-emerald-200 hover:bg-emerald-50/50"
                    : "border-transparent"
            }`}
          >
            <BlockMarkdown
              source={block.source}
              onAnchor={onAnchor}
              highlightQuery={q}
            />
          </div>
        );
      })}
    </>
  );
}
