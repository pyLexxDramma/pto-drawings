import { Fragment, type ReactNode } from "react";

type HighlightOpts = {
  /** Первое совпадение — якорь для scrollIntoView (Где в ПД). */
  focusFirst?: boolean;
};

/** Разбивает строку и оборачивает вхождения query в <mark>. */
export function highlightPlain(
  text: string,
  query: string,
  opts?: HighlightOpts,
): ReactNode {
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
    const focused = Boolean(opts?.focusFirst && key === 0);
    parts.push(
      <mark
        key={`h-${key++}`}
        className={
          focused
            ? "rounded-[2px] bg-sky-200 px-0.5 text-inherit ring-2 ring-sky-400"
            : "rounded-[2px] bg-amber-200 px-0.5 text-inherit"
        }
        {...(focused ? { "data-focus-quote": "" } : {})}
      >
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    start = index + needle.length;
    index = lower.indexOf(q, start);
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts.length === 1 ? parts[0] : <Fragment>{parts}</Fragment>;
}

const FLAG_CLASS =
  "rounded-[2px] bg-rose-200/80 px-0.5 text-inherit underline decoration-rose-500 decoration-dotted";

/**
 * Подсветка цитат из таблицы замечаний: инженеру видно, к какому месту текста
 * прицепилась находка, без чтения всего листа.
 */
function flagPlain(text: string, terms: string[]): ReactNode {
  if (!text) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let start = 0;
  let key = 0;

  for (;;) {
    let at = -1;
    let length = 0;
    for (const term of terms) {
      const index = lower.indexOf(term, start);
      if (index < 0) continue;
      // Самое раннее вхождение, при равенстве — самое длинное.
      if (at < 0 || index < at || (index === at && term.length > length)) {
        at = index;
        length = term.length;
      }
    }
    if (at < 0) break;
    if (at > start) parts.push(text.slice(start, at));
    parts.push(
      <mark key={`f-${key++}`} className={FLAG_CLASS}>
        {text.slice(at, at + length)}
      </mark>,
    );
    start = at + length;
  }

  if (parts.length === 0) return text;
  if (start < text.length) parts.push(text.slice(start));
  return <Fragment>{parts}</Fragment>;
}

/** Те же цитаты, но по дереву узлов react-markdown. */
export function flagNodes(children: ReactNode, quotes: string[]): ReactNode {
  const terms = quotes
    .map((quote) => quote.trim().toLowerCase())
    .filter((quote) => quote.length >= 3);
  if (terms.length === 0) return children;
  if (typeof children === "string" || typeof children === "number") {
    return flagPlain(String(children), terms);
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{flagNodes(child, terms)}</Fragment>
    ));
  }
  return children;
}

export type FocusHighlightState = { focusLeft: boolean };

/** Рекурсивно подсвечивает текстовые узлы в children react-markdown. */
export function highlightNodes(
  children: ReactNode,
  query: string,
  opts?: HighlightOpts,
): ReactNode {
  const needle = query.trim();
  if (needle.length < 2) return children;
  const state: FocusHighlightState = { focusLeft: Boolean(opts?.focusFirst) };
  return highlightNodesInner(children, needle, state);
}

/** Как highlightNodes, но с общим state (один якорь на весь markdown). */
export function highlightNodesShared(
  children: ReactNode,
  query: string,
  state: FocusHighlightState,
): ReactNode {
  const needle = query.trim();
  if (needle.length < 2) return children;
  return highlightNodesInner(children, needle, state);
}

function highlightNodesInner(
  children: ReactNode,
  needle: string,
  state: FocusHighlightState,
): ReactNode {
  if (typeof children === "string" || typeof children === "number") {
    const text = String(children);
    const focusFirst = state.focusLeft;
    if (focusFirst && text.toLowerCase().includes(needle.toLowerCase())) {
      state.focusLeft = false;
    }
    return highlightPlain(text, needle, focusFirst ? { focusFirst: true } : undefined);
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{highlightNodesInner(child, needle, state)}</Fragment>
    ));
  }
  return children;
}
