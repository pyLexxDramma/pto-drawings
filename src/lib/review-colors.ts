import type { ReviewSeverity, ReviewVerdict } from "@/types";

/**
 * Одна ось цвета: статус замечания. Три смысла и ни одного больше —
 * issue (расхождение, неверно), ok (подтверждено), attn (внимание).
 *
 * Вторая ось — подсветка на чертеже (зелёная рамка / оранжевое значение /
 * синие другие места) — живёт в ui-chrome.tsx и здесь не участвует. Обе оси
 * зафиксированы в docs/page-contract.md: до этого orange значил и «среднюю
 * важность», и подсветку значения, а sky — и «низкую важность», и таб этапа.
 *
 * Важность цветом больше не передаётся: цветов было бы шесть и они спорили бы
 * со статусом. Она идёт формой — толщина левой полосы строки плюс подпись.
 */

const CHIP_ISSUE =
  "border-sem-issue-line bg-sem-issue-soft text-sem-issue-text";
const CHIP_OK = "border-sem-ok-line bg-sem-ok-soft text-sem-ok-text";
const CHIP_ATTN = "border-sem-attn-line bg-sem-attn-soft text-sem-attn-text";
const CHIP_NEUTRAL = "border-slate-300 bg-white text-slate-500";

/** Важность: один тон, три насыщенности. Смысл несёт подпись, не цвет. */
export const SEVERITY_CHIP: Record<ReviewSeverity, string> = {
  unset: "border-dashed border-slate-400 bg-white text-slate-500",
  high: "border-sem-issue bg-sem-issue text-white",
  medium: "border-sem-issue-line bg-sem-issue-soft text-sem-issue-text",
  low: "border-slate-300 bg-white text-slate-600",
  skip: "border-slate-300 bg-slate-100 text-slate-500 line-through",
};

export const VERDICT_CHIP: Record<ReviewVerdict, string> = {
  pending: CHIP_NEUTRAL,
  confirmed: CHIP_OK,
  partial: CHIP_ATTN,
  discuss: CHIP_ATTN,
  outdated: "border-slate-300 bg-slate-100 text-slate-500 line-through",
  wrong: `${CHIP_ISSUE} font-semibold`,
};

/**
 * Левая полоса строки — только важность, и только толщиной. Заливку строки
 * даёт разбор (VERDICT_ROW): раньше фон красили оба, и разбор перекрывал
 * важность — выходило, что цвет строки не значил ничего определённого.
 */
export const SEVERITY_ROW: Record<ReviewSeverity, string> = {
  unset: "border-l-2 border-l-slate-200",
  high: "border-l-4 border-l-sem-issue",
  medium: "border-l-4 border-l-sem-issue-line",
  low: "border-l-2 border-l-slate-300",
  skip: "border-l-2 border-l-slate-200 opacity-60",
};

/** Заливка строки: единственный источник — разбор. «Не разобрано» без заливки. */
export const VERDICT_ROW: Partial<Record<ReviewVerdict, string>> = {
  confirmed: "bg-sem-ok-soft",
  partial: "bg-sem-attn-soft",
  discuss: "bg-sem-attn-soft",
  outdated: "bg-slate-100 opacity-60",
  wrong: "bg-sem-issue-soft",
};

/** Счётчик замечаний на миниатюре листа: цвет — по разбору. */
export const VERDICT_COUNT: Record<ReviewVerdict, string> = {
  pending: "bg-slate-200 text-slate-700",
  confirmed: "bg-sem-ok text-white",
  partial: "bg-sem-attn text-white",
  discuss: "bg-sem-attn text-white",
  outdated: "bg-slate-400 text-white",
  wrong: "bg-sem-issue text-white",
};

export const VERDICT_DOT: Record<ReviewVerdict, string> = {
  pending: "bg-slate-300",
  confirmed: "bg-sem-ok",
  partial: "bg-sem-attn",
  discuss: "bg-sem-attn",
  outdated: "bg-slate-400",
  wrong: "bg-sem-issue",
};

/**
 * «Частично верно» и «Обсудить» теперь одного цвета — различать их должна
 * форма. Точка внутри — у «Обсудить», чтобы кружки не слились.
 */
export const VERDICT_DOT_INNER: Partial<Record<ReviewVerdict, boolean>> = {
  discuss: true,
};
