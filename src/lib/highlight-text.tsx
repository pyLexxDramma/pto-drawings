import {
  cloneElement,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { normalizeQuote } from "@/lib/remark-jump";
import { stripMarkdownMarks } from "@/lib/sheet-label";

/** Шифры и числа из формулировки: К1, ВСХ-20, 42.5, Ду100. */
export function extractCiphers(query: string): string[] {
  const raw = query.trim();
  if (!raw) return [];
  const found = [
    ...(raw.match(/\d{1,3}\/\d{1,3}/g) ?? []),
    ...(raw.match(/[A-Za-zА-Яа-яЁё]{1,8}[-–/.]?\d[\d.,A-Za-zА-Яа-яЁё]*/g) ?? []),
    ...(raw.match(/\d+(?:[.,]\d+)+/g) ?? []),
    ...(raw.match(/\d{3,}/g) ?? []),
  ];
  return [...new Set(found.map((item) => item.trim()).filter((item) => item.length >= 2))];
}

/** Варианты строки для поиска на чертеже (длинная цитата → короче). */
export function highlightNeedles(query: string): string[] {
  const raw = stripMarkdownMarks(normalizeQuote(query));
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
  for (const cipher of extractCiphers(query)) {
    needles.push(normalizeQuote(cipher));
  }
  return [...new Set(needles)].sort((a, b) => b.length - a.length);
}

/** Сначала шифр/число, которое есть в тексте, иначе обычная цитата. */
export function preferHighlightQuery(query: string, haystack = ""): string {
  const raw = query.trim();
  if (raw.length < 2) return raw;
  const hay = stripMarkdownMarks(normalizeQuote(haystack));
  for (const cipher of extractCiphers(raw).sort((a, b) => b.length - a.length)) {
    if (/^\d{1,2}$/.test(cipher)) continue;
    if (!hay || hay.includes(normalizeQuote(cipher))) return cipher;
  }
  if (hay) {
    if (hay.includes(stripMarkdownMarks(normalizeQuote(raw)))) return raw;
    for (const needle of highlightNeedles(raw)) {
      if (hay.includes(needle)) return needle;
    }
  }
  if (raw.length <= 56) return raw;
  const cut = raw.slice(0, 56).replace(/\s+\S*$/, "");
  return cut.length >= 2 ? cut : raw.slice(0, 40);
}

const STOP_TERMS = new Set([
  "нет",
  "лист",
  "или",
  "для",
  "при",
  "как",
  "что",
  "это",
  "том",
  "все",
  "они",
  "его",
  "ее",
  "её",
  "без",
  "над",
  "под",
  "между",
  "после",
  "только",
  "также",
  "раздел",
  "чертеж",
  "схема",
]);

function keepTerm(term: string): boolean {
  const n = normalizeQuote(term);
  if (n.length >= 2 && /\d/.test(n)) return true;
  if (n.length < 3) return false;
  return !STOP_TERMS.has(n);
}

/** Что подсветить в расшифровке: цитата, шифры/числа из замечания, куски формулировки. */
export function remarkTermsInMarkdown(
  markdown: string,
  remarks: Array<{ text?: string; aiFinding?: string; quotes?: string[] }>,
  extra: string[] = [],
): string[] {
  const hay = stripMarkdownMarks(normalizeQuote(markdown));
  const out = new Set<string>();
  for (const item of extra) {
    const t = item.trim();
    if (t && (!hay || hay.includes(stripMarkdownMarks(normalizeQuote(t))))) out.add(t);
  }
  if (!hay) return [...out];
  for (const remark of remarks) {
    for (const quote of remark.quotes ?? []) {
      const t = quote.trim();
      if (t.length >= 2 && hay.includes(stripMarkdownMarks(normalizeQuote(t)))) out.add(t);
    }
    const blob = `${remark.text ?? ""} ${remark.aiFinding ?? ""}`.trim();
    if (!blob) continue;
    for (const needle of highlightNeedles(blob)) {
      if (keepTerm(needle) && hay.includes(needle)) out.add(needle);
    }
    for (const token of blob.match(/[A-Za-zА-Яа-яЁё0-9]+(?:[-–./]\d[\d.,]*)?/g) ?? []) {
      if (keepTerm(token) && hay.includes(normalizeQuote(token))) out.add(token);
    }
  }
  return [...out];
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

/** Куски одного совпадения в одной строке склеиваем в один прямоугольник. */
function mergeHits(hits: LayerTextHit[]): LayerTextHit[] {
  const sorted = [...hits].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: LayerTextHit[] = [];
  for (const hit of sorted) {
    const last = merged[merged.length - 1];
    const sameLine =
      last &&
      Math.abs(last.y + last.h / 2 - (hit.y + hit.h / 2)) <
        Math.max(last.h, hit.h) * 0.6;
    const adjacent = last && hit.x - (last.x + last.w) < 0.02;
    if (last && sameLine && adjacent) {
      const x1 = Math.max(last.x + last.w, hit.x + hit.w);
      const y0 = Math.min(last.y, hit.y);
      const y1 = Math.max(last.y + last.h, hit.y + hit.h);
      last.x = Math.min(last.x, hit.x);
      last.y = y0;
      last.w = x1 - last.x;
      last.h = y1 - y0;
      continue;
    }
    merged.push({ ...hit });
  }
  return merged.map(clampHit);
}

/**
 * Совпадения оставляем в рамке места: то же значение в соседних строках листа
 * сбивает — инженер смотрит на строку замечания. Если в рамке ничего не
 * попало (рамка конвейера мимо), отдаём всё, иначе лист выглядит пустым.
 */
export function hitsInsideRegion<
  T extends { x: number; y: number; w: number; h: number },
>(
  hits: T[],
  region: { x: number; y: number; w: number; h: number } | null,
): T[] {
  if (!region || hits.length === 0) return hits;
  const pad = Math.max(0.004, region.h * 0.5);
  const inside = hits.filter((hit) => {
    const cx = hit.x + hit.w / 2;
    const cy = hit.y + hit.h / 2;
    return (
      cx >= region.x - pad &&
      cx <= region.x + region.w + pad &&
      cy >= region.y - pad &&
      cy <= region.y + region.h + pad
    );
  });
  return inside.length > 0 ? inside : hits;
}

/**
 * Ищет цитату в текстовом слое: берём самый длинный подошедший needle,
 * прямоугольники обрезаны по доле совпавшего текста — не вся строка листа.
 */
export function findLayerHits(
  items: Array<{ text: string; x: number; y: number; w: number; h: number }>,
  query: string,
): LayerTextHit[] {
  const needles = highlightNeedles(query);
  if (needles.length === 0 || items.length === 0) return [];

  const norm = items.map((item) => normalizeQuote(item.text));

  // 1) Совпадение целиком внутри одного фрагмента текстового слоя.
  for (const needle of needles) {
    const hits: LayerTextHit[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const hay = norm[i];
      if (!hay) continue;
      const at = hay.indexOf(needle);
      if (at < 0) continue;
      hits.push(hitForMatch(items[i], hay, at, at + needle.length));
    }
    if (hits.length > 0) return mergeHits(hits);
  }

  // 2) Цитата разрезана на соседние фрагменты — ищем в склеенной строке.
  const parts: { start: number; end: number; index: number }[] = [];
  let concat = "";
  for (let i = 0; i < items.length; i += 1) {
    if (!norm[i]) continue;
    if (concat.length > 0) concat += " ";
    const start = concat.length;
    concat += norm[i];
    parts.push({ start, end: concat.length, index: i });
  }
  if (!concat) return [];

  for (const needle of needles) {
    const at = concat.indexOf(needle);
    if (at < 0) continue;
    const end = at + needle.length;
    const matched = parts.filter((part) => part.end > at && part.start < end);
    if (matched.length === 0) continue;
    return mergeHits(
      matched.map((part) => {
        const item = items[part.index];
        const hay = norm[part.index];
        const localStart = Math.max(0, at - part.start);
        const localEnd = Math.min(hay.length, end - part.start);
        return hitForMatch(item, hay, localStart, localEnd);
      }),
    );
  }
  return [];
}

/** Знаки, которые normalizeQuote срезает из цитаты, а в тексте листа они есть. */
const NOISE = "*_`~«»„“”\"'′";
const NOISE_CLASS = `[${NOISE.replace(/[\]\\^-]/g, "\\$&")}]`;
const DASH_CLASS = "[-\u2013\u2014\u2212]";

/** Находит вхождения needle в text с гибкими пробелами; индексы — в исходном text. */
export function findQuoteRanges(
  text: string,
  query: string,
): { index: number; length: number }[] {
  const needle = stripMarkdownMarks(normalizeQuote(query));
  if (needle.length < 2 || !text) return [];
  // Разметка и кавычки рвут фразу в любом месте: «**250 кВт**, а по» — поэтому
  // между любыми двумя символами цитаты они допускаются. Тире в цитате уже
  // сведено к дефису, в тексте листа остаётся длинным — равняем и его.
  const pattern = [...needle]
    .map((char) => {
      if (/\s/.test(char)) return `[\\s${NOISE.replace(/[\]\\^-]/g, "\\$&")}]+`;
      const one = char === "-" ? DASH_CLASS : char.replace(/[.*+?^${}()|[\]\\]/, "\\$&");
      return `${one}${NOISE_CLASS}*`;
    })
    .join("");
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
  const plain = stripMarkdownMarks(query.trim().toLowerCase());
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
  /** Совпадения годятся как цель прокрутки: data-focus-quote. */
  placeAnchor?: boolean;
};

/** Разбивает строку и оборачивает вхождения query в <mark>. */
export function highlightPlain(
  text: string,
  query: string,
  opts?: HighlightOpts,
): ReactNode {
  return markRanges(text, findQuoteRanges(text, query), opts);
}

/** Оборачивает готовые отрезки текста в <mark>. */
function markRanges(
  text: string,
  ranges: { index: number; length: number }[],
  opts?: HighlightOpts,
): ReactNode {
  if (ranges.length === 0) return text;
  const parts: ReactNode[] = [];
  let start = 0;
  let key = 0;
  for (const range of ranges) {
    if (range.index > start) parts.push(text.slice(start, range.index));
    const isAnchor = Boolean(opts?.placeAnchor);
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
    .filter((quote) => quote.length >= 3 || (quote.length >= 2 && /\d/.test(quote)));
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

/**
 * Режим «Где в ПД»: все совпадения мигают красным и каждое годится как цель
 * прокрутки. Раньше здесь жил флаг «якорь ещё не поставлен», и его мутировали
 * по ходу обхода. Перерисовка одной секции листа этот флаг уже не возвращала —
 * якоря на листе не оставалось, и вьюер честно писал «в расшифровке точного
 * совпадения нет», хотя цитата была на экране (0094). Теперь якорем помечаются
 * все совпадения, а первым в документе всё равно будет первое.
 */
export type FocusHighlightState = {
  focusStyle: boolean;
};

/** Рекурсивно подсвечивает текстовые узлы в children react-markdown. */
export function highlightNodes(
  children: ReactNode,
  query: string,
  opts?: { focusFirst?: boolean },
): ReactNode {
  const needle = query.trim();
  if (needle.length < 2) return children;
  const state: FocusHighlightState = { focusStyle: Boolean(opts?.focusFirst) };
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

/** Плоский текст поддерева — в том же порядке, в каком его обходит подсветка. */
function flattenNodes(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(flattenNodes).join("");
  if (isValidElement(children)) {
    const props = (children as ReactElement<{ children?: ReactNode }>).props;
    return props.children === undefined ? "" : flattenNodes(props.children);
  }
  return "";
}

/** Курсор обхода: сколько символов абзаца уже пройдено. */
type HighlightWalk = {
  state: FocusHighlightState;
  ranges: { index: number; length: number }[];
  at: number;
};

function highlightNodesInner(
  children: ReactNode,
  needle: string,
  state: FocusHighlightState,
): ReactNode {
  // Цитату ищем по тексту всего абзаца: модель выделяет числа разметкой, и
  // «принята **250 кВт**, а по расчёту 180 кВт» приезжает в браузер тремя
  // узлами. Поузловой поиск такую фразу не находил вовсе (0094).
  const ranges = findQuoteRanges(flattenNodes(children), needle);
  if (ranges.length === 0) return children;
  return highlightWalk(children, { state, ranges, at: 0 });
}

function highlightWalk(children: ReactNode, walk: HighlightWalk): ReactNode {
  if (typeof children === "string" || typeof children === "number") {
    const text = String(children);
    const start = walk.at;
    walk.at += text.length;
    const local: { index: number; length: number }[] = [];
    for (const range of walk.ranges) {
      const from = Math.max(range.index, start);
      const to = Math.min(range.index + range.length, start + text.length);
      if (to > from) local.push({ index: from - start, length: to - from });
    }
    return markRanges(text, local, {
      focusStyle: walk.state.focusStyle,
      placeAnchor: walk.state.focusStyle,
    });
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{highlightWalk(child, walk)}</Fragment>
    ));
  }
  if (isValidElement(children)) {
    return mapElementChildren(
      children as ReactElement<{ children?: ReactNode }>,
      (inner) => highlightWalk(inner, walk),
    );
  }
  return children;
}
