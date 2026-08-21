"use client";

import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown-schema";

type MarkdownViewProps = {
  children: string;
  /** Клик по заголовку / номеру листа — якорь к PDF. */
  onAnchor?: (payload: { text: string; pageHint: number | null }) => void;
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
}: {
  tag: "h1" | "h2" | "h3";
  children: ReactNode;
  onAnchor?: MarkdownViewProps["onAnchor"];
}) {
  const text = flattenText(children);
  return (
    <Tag>
      <button
        type="button"
        className="cursor-pointer text-left hover:text-accent hover:underline"
        title="Показать на чертеже"
        onClick={() => onAnchor?.({ text, pageHint: pageHintFromText(text) })}
      >
        {children}
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

/** Единственное место, где markdown листа превращается в HTML. */
export function MarkdownView({ children, onAnchor }: MarkdownViewProps) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
      components={
        onAnchor
          ? {
              h1: ({ children: c }) => (
                <AnchorHeading tag="h1" onAnchor={onAnchor}>
                  {c}
                </AnchorHeading>
              ),
              h2: ({ children: c }) => (
                <AnchorHeading tag="h2" onAnchor={onAnchor}>
                  {c}
                </AnchorHeading>
              ),
              h3: ({ children: c }) => (
                <AnchorHeading tag="h3" onAnchor={onAnchor}>
                  {c}
                </AnchorHeading>
              ),
            }
          : undefined
      }
    >
      {children}
    </Markdown>
  );
}
