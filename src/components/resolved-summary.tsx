"use client";

import { VERDICT_DOT } from "@/lib/review-colors";
import {
  REVIEW_VERDICT_LABEL,
  type Review,
  type ReviewVerdict,
} from "@/types";

/** Итоги разбора по порядку разговора с заказчиком, «не разобрано» отдельно. */
export const RESOLVED_ORDER: ReviewVerdict[] = [
  "confirmed",
  "partial",
  "discuss",
  "outdated",
  "wrong",
];

export function resolvedCounts(reviews: Review[]) {
  const counts = new Map<ReviewVerdict, number>();
  let resolved = 0;
  for (const review of reviews) {
    if (review.severity === "skip") continue;
    counts.set(review.verdict, (counts.get(review.verdict) ?? 0) + 1);
    if (review.verdict !== "pending") resolved += 1;
  }
  const total = reviews.filter((review) => review.severity !== "skip").length;
  return { counts, resolved, total };
}

export function reviewsPageUrl(projectId: string): string {
  return `/reviews?project=${encodeURIComponent(projectId)}`;
}

/**
 * Маленькое окно итогов разбора: кружки по статусам с числами, подписи — по
 * наведению. Клик открывает разобранные замечания в отдельной вкладке.
 */
export function ResolvedSummary({
  reviews,
  projectId,
  className = "",
  compact = false,
}: {
  reviews: Review[];
  projectId: string;
  className?: string;
  /** Одна строка: для шапки таблицы, где высота на счёт. */
  compact?: boolean;
}) {
  const { counts, resolved, total } = resolvedCounts(reviews);
  if (total === 0) return null;
  const shown = RESOLVED_ORDER.filter((verdict) => (counts.get(verdict) ?? 0) > 0);
  const open = () => {
    // Без noopener: из новой вкладки нужно вернуться в эту и показать место.
    window.open(reviewsPageUrl(projectId), "_blank");
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={open}
        title="Открыть разобранные замечания в отдельной вкладке"
        className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-white px-1.5 py-0.5 text-[11px] leading-none hover:border-accent hover:bg-blue-50/60 ${className}`}
      >
        <span className="font-medium text-text tabular-nums">
          Разобрано {resolved} из {total}
        </span>
        {shown.map((verdict) => (
          <span
            key={verdict}
            title={`${REVIEW_VERDICT_LABEL[verdict]}: ${counts.get(verdict)}`}
            className="inline-flex items-center gap-0.5 text-muted"
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${VERDICT_DOT[verdict]}`}
            />
            <span className="tabular-nums">{counts.get(verdict)}</span>
          </span>
        ))}
        <span className="text-accent underline decoration-dotted">открыть</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      title="Открыть разобранные замечания в отдельной вкладке"
      className={`w-full rounded-md border border-border bg-white px-1.5 py-1 text-left hover:border-accent hover:bg-blue-50/60 ${className}`}
    >
      <div className="flex items-center justify-between gap-1 text-[10px] font-medium text-text">
        <span className="tabular-nums">
          Разобрано {resolved} из {total}
        </span>
        <span className="text-[9px] text-accent underline decoration-dotted">
          открыть
        </span>
      </div>
      {shown.length > 0 ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {shown.map((verdict) => (
            <span
              key={verdict}
              title={`${REVIEW_VERDICT_LABEL[verdict]}: ${counts.get(verdict)}`}
              className="group/sum relative inline-flex items-center gap-0.5 text-[10px] text-muted"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${VERDICT_DOT[verdict]}`}
              />
              <span className="tabular-nums">{counts.get(verdict)}</span>
              <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-1.5 py-0.5 text-[10px] leading-none text-white shadow-sm group-hover/sum:block">
                {REVIEW_VERDICT_LABEL[verdict]}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-0.5 text-[10px] text-muted">
          Поставьте статус в таблице — итоги появятся здесь
        </div>
      )}
    </button>
  );
}
