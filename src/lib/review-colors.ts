import type { ReviewSeverity, ReviewVerdict } from "@/types";

/**
 * Важность и статус разбора — две отдельные шкалы, у каждого значения свой цвет.
 * Иначе в выпадашке «высокий» красит все пункты, а «частично» и «обсудить»
 * сливаются в один янтарный.
 */

export const SEVERITY_CHIP: Record<ReviewSeverity, string> = {
  unset: "border-dashed border-slate-400 bg-white text-slate-500",
  high: "border-rose-300 bg-rose-100 text-rose-800",
  medium: "border-amber-300 bg-amber-100 text-amber-900",
  low: "border-sky-300 bg-sky-100 text-sky-800",
  skip: "border-slate-300 bg-slate-100 text-slate-500 line-through",
};

export const VERDICT_CHIP: Record<ReviewVerdict, string> = {
  pending: "border-slate-300 bg-slate-100 text-slate-600",
  confirmed: "border-emerald-300 bg-emerald-100 text-emerald-800",
  partial: "border-violet-300 bg-violet-100 text-violet-800",
  discuss: "border-amber-300 bg-amber-100 text-amber-900",
  outdated: "border-slate-300 bg-slate-200 text-slate-500 line-through",
  wrong: "border-rose-300 bg-rose-100 text-rose-800",
};

/**
 * Строка белая. Важность — яркая рамка, не заливка: иначе длинное замечание
 * выглядит как полоса одного цвета, и средний с высоким спорят с фоном.
 *
 * На `<tr>` ring часто не рисуется (особенно при border-separate), поэтому
 * рамку кладём на ячейки: верх/низ у всех, левый край у первой, правый у последней.
 */
export const SEVERITY_ROW: Record<ReviewSeverity, string> = {
  unset: "bg-white",
  high: "bg-white ring-2 ring-inset ring-rose-500",
  medium: "bg-white ring-2 ring-inset ring-amber-500",
  low: "bg-white ring-2 ring-inset ring-sky-500",
  skip: "bg-white opacity-60",
};

const SEVERITY_EDGE: Record<ReviewSeverity, string> = {
  unset: "",
  high: "border-rose-500",
  medium: "border-amber-500",
  low: "border-sky-500",
  skip: "",
};

export function severityCellFrame(
  severity: ReviewSeverity,
  edge: "first" | "mid" | "last",
): string {
  const color = SEVERITY_EDGE[severity];
  if (!color) return "";
  if (edge === "first") return `border-y-2 border-l-2 ${color}`;
  if (edge === "last") return `border-y-2 border-r-2 ${color}`;
  return `border-y-2 ${color}`;
}

/** Заливку по статусу не даём: статус читается подписью, не фоном строки. */
export const VERDICT_ROW: Partial<Record<ReviewVerdict, string>> = {};

/** Счётчик замечаний на миниатюре листа: цвет — по разбору. */
export const VERDICT_COUNT: Record<ReviewVerdict, string> = {
  pending: "bg-slate-200 text-slate-700",
  confirmed: "bg-emerald-600 text-white",
  partial: "bg-violet-500 text-white",
  discuss: "bg-amber-500 text-white",
  outdated: "bg-slate-400 text-white",
  wrong: "bg-rose-500 text-white",
};

export const VERDICT_DOT: Record<ReviewVerdict, string> = {
  pending: "bg-slate-300",
  confirmed: "bg-emerald-600",
  partial: "bg-violet-500",
  discuss: "bg-amber-500",
  outdated: "bg-slate-400",
  wrong: "bg-rose-500",
};

/**
 * «Обсудить» — точка внутри кружка, чтобы не слиться с «Частично верно».
 */
export const VERDICT_DOT_INNER: Partial<Record<ReviewVerdict, boolean>> = {
  discuss: true,
};
