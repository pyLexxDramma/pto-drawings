import { Fragment, type ReactNode } from "react";

/** Разбивает строку и оборачивает вхождения query в <mark>. */
export function highlightPlain(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (needle.length < 2 || !text) return text;
  const lower = text.toLowerCase();
  const q = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let start = 0;
  let index = lower.indexOf(q, start);
  let key = 0;
  while (index >= 0) {
    if (index > start) parts.push(text.slice(start, index));
    parts.push(
      <mark key={`h-${key++}`} className="rounded-[2px] bg-amber-200 px-0.5 text-inherit">
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    start = index + needle.length;
    index = lower.indexOf(q, start);
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts.length === 1 ? parts[0] : <Fragment>{parts}</Fragment>;
}

/** Рекурсивно подсвечивает текстовые узлы в children react-markdown. */
export function highlightNodes(children: ReactNode, query: string): ReactNode {
  const needle = query.trim();
  if (needle.length < 2) return children;
  if (typeof children === "string" || typeof children === "number") {
    return highlightPlain(String(children), needle);
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{highlightNodes(child, needle)}</Fragment>
    ));
  }
  return children;
}
