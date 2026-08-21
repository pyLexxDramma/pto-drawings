"use client";

import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { highlightNodes } from "@/lib/highlight-text";
import { markdownSanitizeSchema } from "@/lib/markdown-schema";

type MarkdownViewProps = {
  children: string;
  /** Клик по заголовку / номеру листа — якорь к PDF. */
  onAnchor?: (payload: { text: string; pageHint: number | null }) => void;
  /** Подсветка совпадений поиска в тексте. */
  highlightQuery?: string;
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

/** Единственное место, где markdown листа превращается в HTML. */
export function MarkdownView({
  children,
  onAnchor,
  highlightQuery = "",
}: MarkdownViewProps) {
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
      {children}
    </Markdown>
  );
}
