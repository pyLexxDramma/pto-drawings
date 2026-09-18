import type { ReviewSeverity, ReviewVerdict } from "@/types";

/** Важность и разбор — разные палитры, чтобы «низкий» не был как «верно». */
export const SEVERITY_CHIP: Record<ReviewSeverity, string> = {
  unset: "border-dashed border-slate-400 bg-white text-slate-500",
  high: "border-red-400 bg-red-100 text-red-950",
  medium: "border-orange-400 bg-orange-100 text-orange-950",
  low: "border-sky-400 bg-sky-100 text-sky-950",
  skip: "border-slate-300 bg-slate-100 text-slate-600",
};

export const VERDICT_CHIP: Record<ReviewVerdict, string> = {
  pending: "border-slate-300 bg-white text-slate-500",
  confirmed: "border-emerald-500 bg-emerald-50 text-emerald-900",
  partial: "border-amber-500 bg-amber-50 text-amber-950",
  discuss: "border-violet-400 bg-violet-50 text-violet-950",
  outdated: "border-slate-300 bg-slate-100 text-slate-500 line-through",
  wrong: "border-rose-500 bg-rose-100 font-semibold text-rose-950",
};

export const SEVERITY_ROW: Record<ReviewSeverity, string> = {
  unset: "border-l-slate-300 bg-white",
  high: "border-l-red-600 bg-red-50/70",
  medium: "border-l-orange-500 bg-orange-50/60",
  low: "border-l-sky-500 bg-sky-50/50",
  skip: "border-l-slate-300 bg-slate-50 opacity-60",
};

export const VERDICT_ROW: Partial<Record<ReviewVerdict, string>> = {
  confirmed: "bg-emerald-100/80",
  partial: "bg-amber-100/70",
  discuss: "bg-violet-100/70",
  outdated: "bg-slate-100 opacity-60",
  wrong: "bg-rose-100/80",
};

/** Счётчик замечаний на миниатюре листа: цвет — по разбору. */
export const VERDICT_COUNT: Record<ReviewVerdict, string> = {
  pending: "bg-slate-200 text-slate-700",
  confirmed: "bg-emerald-500 text-white",
  partial: "bg-amber-500 text-white",
  discuss: "bg-violet-500 text-white",
  outdated: "bg-slate-400 text-white",
  wrong: "bg-rose-500 text-white",
};

export const VERDICT_DOT: Record<ReviewVerdict, string> = {
  pending: "bg-slate-300",
  confirmed: "bg-emerald-500",
  partial: "bg-amber-500",
  discuss: "bg-violet-500",
  outdated: "bg-slate-400",
  wrong: "bg-rose-500",
};
