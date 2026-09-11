import {
  cloneElement,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { normalizeQuote } from "@/lib/remark-jump";

/** Варианты строки для поиска на чертеже (длинная цитата → короче). */
export function highlightNeedles(query: string): string[] {
  const raw = normalizeQuote(query);
  if (raw.length < 2) return [];
  const needles = [raw];
  if (raw.length > 48) {
    const cut = raw.slice(0, 48).replace(/\s+\S*$/, "");
    if (cut.length >= 2) needles.push(cut);
  }
  const words = raw.split(" ").filter((word) => word.length >= 3);
  // Не дробить до одного слова — иначе подсветка целых строк по «площадь».
  const minWords = words.length >= 2 ? 2 : 1;
  for (let n = Math.min(4, words.length); n >= minWords; n -= 1) {
    const part = words.slice(0, n).join(" ");
    if (part.length >= 3) needles.push(part);
  }
  return [...new Set(needles)].sort((a, b) => b.length - a.length);
}

/** Фрагмент текстового слоя чертежа (нормализованные координаты 0..1). */
export type LayerTextHit = { x: number; y: number; w: number; h: number };

function clampHit(hit: LayerTextHit): LayerTextHit {
  const x = Math.min(1, Math.max(0, hit.x));
  const y = Math.min(1, Math.max(0, hit.y));
  const w = Math.min(1 - x, Math.max(0.004, hit.w));
  const h = Math.min(1 - y, Math.max(0.004, hit.h));
  return { x, y, w, h };
}

/** Доля совпадения внутри item → узкий прямоугольник только по цитате. */
function hitForMatch(
  item: { x: number; y: number; w: number; h: number; text?: string },
  hay: string,
  matchStart: number,
  matchEnd: number,
): LayerTextHit {
  const len = Math.max(1, hay.length);
  const start = Math.max(0, Math.min(len, matchStart));
  const end = Math.max(start, Math.min(len, matchEnd));
  const x = item.x + item.w * (start / len);
  const w = item.w * Math.max(0.02, (end - start) / len);
  return clampHit({ x, y: item.y, w, h: item.h });
}

/**
 * Ищет цитату в текстовом слое: одно лучшее вхождение (самый длинный needle),
 * прямоугольники обрезаны по доле совпавшего текста — не вся строка листа.
 */
export function findLayerHits(
  items: Array<{ text: string; x: number; y: number; w: number; h: number }>,
  query: string,
): LayerTextHit[] {
  const needles = highlightNeedles(query);
  if (needles.length === 0 || items.length === 0) return [];

  for (const needle of needles) {
    const singles: LayerTextHit[] = [];
    for (const item of items) {
      const hay = normalizeQuote(item.text);
      if (!hay) continue;
      const at = hay.indexOf(needle);
      if (at < 0) continue;
      singles.push(hitForMatch(item, hay, at, at + needle.length));
    }
    if (singles.length > 0) {
      // Одно вхождение: ближайшее к «полному» совпадению (уже longest needle).
      return [singles[0]];
    }
  }

  const parts: { start: number; end: number; index: number }[] = [];
  let concat = "";
  for (let i = 0; i < items.length; i += 1) {
    const norm = normalizeQuote(items[i].text);
    if (!norm) continue;
    if (concat.length > 0) concat += " ";
    const start = concat.length;
    concat += norm;
    parts.push({ start, end: concat.length, index: i });
  }
  if (!concat) return [];

  for (const needle of needles) {
    const at = concat.indexOf(needle);
    if (at < 0) continue;
    const end = at + needle.length;
    const matched = parts.filter((part) => part.end > at && part.start < end);
    if (matched.length === 0) continue;
    return matched.map((part) => {
      const item = items[part.index];
      const hay = normalizeQuote(item.text);
      const localStart = Math.max(0, at - part.start);
      const localEnd = Math.min(hay.length, end - part.start);
      return hitForMatch(item, hay, localStart, localEnd);
    });
  }
  return [];
}

/** Находит вхождения needle в text с гибкими пробелами; индексы — в исходном text. */
export function findQuoteRanges(
  text: string,
  query: string,
): { index: number; length: number }[] {
  const needle = normalizeQuote(query);
  if (needle.length < 2 || !text) return [];
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\s+/g, "\\s+");
  const re = new RegExp(pattern, "gi");
  const ranges: { index: number; length: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    ranges.push({ index: match.index, length: match[0].length });
    if (match[0].length === 0) re.lastIndex += 1;
  }
  if (ranges.length > 0) return ranges;
  // fallback: прямое вхождение нормализованного куска в lower text
  const lower = text.toLowerCase();
  const plain = query.trim().toLowerCase();
  if (plain.length >= 2) {
    let start = 0;
    let index = lower.indexOf(plain, start);
    while (index >= 0) {
      ranges.push({ index, length: plain.length });
      start = index + plain.length;
      index = lower.indexOf(plain, start);
    }
  }
  return ranges;
}

type HighlightOpts = {
  /** Все совпадения — стиль замечания (мигание). */
  focusStyle?: boolean;
  /** Первое совпадение в этом фрагменте — якорь scroll. */
  placeAnchor?: boolean;
};

/** Разбивает строку и оборачивает вхождения query в <mark>. */
export function highlightPlain(
  text: string,
  query: string,
  opts?: HighlightOpts,
): ReactNode {
  const ranges = findQuoteRanges(text, query);
  if (ranges.length === 0) return text;
  const parts: ReactNode[] = [];
  let start = 0;
  let key = 0;
  let anchorPlaced = false;
  for (const range of ranges) {
    if (range.index > start) parts.push(text.slice(start, range.index));
    const isAnchor = Boolean(opts?.placeAnchor && !anchorPlaced);
    if (isAnchor) anchorPlaced = true;
    parts.push(
      <mark
        key={`h-${key++}`}
        className={
          opts?.focusStyle
            ? "pto-remark-text"
            : "rounded-[2px] bg-amber-200 px-0.5 text-inherit"
        }
        {...(isAnchor ? { "data-focus-quote": "" } : {})}
      >
        {text.slice(range.index, range.index + range.length)}
      </mark>,
    );
    start = range.index + range.length;
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

function mapElementChildren(
  element: ReactElement<{ children?: ReactNode }>,
  map: (child: ReactNode) => ReactNode,
): ReactNode {
  if (element.props.children === undefined) return element;
  return cloneElement(element, {
    ...element.props,
    children: map(element.props.children),
  });
}

/** Те же цитаты, но по дереву узлов react-markdown. */
export function flagNodes(children: ReactNode, quotes: string[]): ReactNode {
  const terms = quotes
    .map((quote) => quote.trim().toLowerCase())
    .filter((quote) => quote.length >= 3);
  if (terms.length === 0) return children;
  return flagNodesInner(children, terms);
}

function flagNodesInner(children: ReactNode, terms: string[]): ReactNode {
  if (typeof children === "string" || typeof children === "number") {
    return flagPlain(String(children), terms);
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{flagNodesInner(child, terms)}</Fragment>
    ));
  }
  if (isValidElement(children)) {
    return mapElementChildren(
      children as ReactElement<{ children?: ReactNode }>,
      (inner) => flagNodesInner(inner, terms),
    );
  }
  return children;
}

export type FocusHighlightState = {
  /** Режим «Где в ПД» — все совпадения мигают красным. */
  focusStyle: boolean;
  /** Ещё не поставили data-focus-quote. */
  anchorLeft: boolean;
};

/** Рекурсивно подсвечивает текстовые узлы в children react-markdown. */
export function highlightNodes(
  children: ReactNode,
  query: string,
  opts?: { focusFirst?: boolean },
): ReactNode {
  const needle = query.trim();
  if (needle.length < 2) return children;
  const state: FocusHighlightState = {
    focusStyle: Boolean(opts?.focusFirst),
    anchorLeft: Boolean(opts?.focusFirst),
  };
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
    const placeAnchor = state.anchorLeft;
    if (placeAnchor && findQuoteRanges(text, needle).length > 0) {
      state.anchorLeft = false;
    }
    return highlightPlain(text, needle, {
      focusStyle: state.focusStyle,
      placeAnchor,
    });
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{highlightNodesInner(child, needle, state)}</Fragment>
    ));
  }
  if (isValidElement(children)) {
    return mapElementChildren(
      children as ReactElement<{ children?: ReactNode }>,
      (inner) => highlightNodesInner(inner, needle, state),
    );
  }
  return children;
}
