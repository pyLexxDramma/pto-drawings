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
 * Красим только клетку «Замечание»: блеклая заливка и яркая рамка по важности.
 * Всю строку заливать нельзя — закрывает текст и красит номер, статус, автора.
 */
export const SEVERITY_REMARK: Record<ReviewSeverity, string> = {
  unset: "",
  high: "border-2 border-rose-500 bg-rose-50",
  medium: "border-2 border-amber-500 bg-amber-50",
  low: "border-2 border-sky-500 bg-sky-50",
  skip: "opacity-60",
};

/** Строка замечания в полосе листа: рамка по важности, заливка блеклая. */
export const SEVERITY_ITEM: Record<ReviewSeverity, string> = {
  unset: "border-slate-300 bg-white",
  high: "border-rose-500 bg-rose-50",
  medium: "border-amber-500 bg-amber-50",
  low: "border-sky-500 bg-sky-50",
  skip: "border-slate-300 bg-white opacity-60",
};

/** Чип места «№1»: та же важность, что у замечания. */
export const SEVERITY_PLACE: Record<ReviewSeverity, string> = {
  unset: "border-slate-400 bg-white text-slate-600",
  high: "border-rose-500 bg-rose-50 text-rose-800",
  medium: "border-amber-500 bg-amber-50 text-amber-900",
  low: "border-sky-500 bg-sky-50 text-sky-800",
  skip: "border-slate-300 bg-slate-100 text-slate-500",
};

/**
 * Рамка места на чертеже и цвет мини-пина — по важности.
 * Неразобранное без важности остаётся rose: это всё равно ошибка на плане.
 */
export const SEVERITY_FRAME: Record<ReviewSeverity, string> = {
  unset: "pto-place",
  high: "pto-place pto-place--high",
  medium: "pto-place pto-place--medium",
  low: "pto-place pto-place--low",
  skip: "pto-place opacity-50",
};

export const SEVERITY_PIN: Record<ReviewSeverity, string> = {
  unset: "bg-rose-600 text-white",
  high: "bg-rose-600 text-white",
  medium: "bg-amber-500 text-white",
  low: "bg-sky-600 text-white",
  skip: "bg-slate-400 text-white",
};

/** Мини-пин замечания на чертеже: номер + место + важность. */
export type DrawingRemarkPin = {
  id: string;
  number: number;
  severity: ReviewSeverity;
  x: number;
  y: number;
  w: number;
  h: number;
  active?: boolean;
};

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
