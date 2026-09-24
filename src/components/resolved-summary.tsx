"use client";

import { VERDICT_CHIP } from "@/lib/review-colors";
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

/** В блоке слева «не разобрано» стоит первым — это то, что ещё ждут. */
const SIDEBAR_ORDER: ReviewVerdict[] = ["pending", ...RESOLVED_ORDER];

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

export function reviewsPageUrl(
  projectId: string,
  verdict?: ReviewVerdict | null,
): string {
  const params = new URLSearchParams({ project: projectId });
  if (verdict) params.set("verdict", verdict);
  return `/reviews?${params.toString()}`;
}

function openReviews(projectId: string, verdict?: ReviewVerdict | null) {
  // Без noopener: из новой вкладки нужно вернуться в эту и показать место.
  window.open(reviewsPageUrl(projectId, verdict), "_blank");
}

function VerdictChip({
  verdict,
  count,
  onClick,
}: {
  verdict: ReviewVerdict;
  count: number;
  onClick?: () => void;
}) {
  const label = `${REVIEW_VERDICT_LABEL[verdict]}: ${count}`;
  const className = `inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 pto-t-xs font-semibold tabular-nums leading-none ${VERDICT_CHIP[verdict]}`;
  if (!onClick) {
    return (
      <span title={label} className={className}>
        {count}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={`Открыть «${REVIEW_VERDICT_LABEL[verdict]}» в отдельной вкладке`}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`${className} hover:brightness-95`}
    >
      {count}
    </button>
  );
}

/**
 * Итоги разбора слева внизу. Заголовок открывает все разобранные, каждая
 * кнопка статуса — ту же вкладку, уже отфильтрованную на этот итог.
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
  const shown = (compact ? RESOLVED_ORDER : SIDEBAR_ORDER).filter(
    (verdict) => (counts.get(verdict) ?? 0) > 0,
  );

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => openReviews(projectId)}
        title="Открыть разобранные замечания в отдельной вкладке"
        className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-white px-1.5 py-0.5 pto-t-md leading-none hover:border-accent hover:bg-blue-50/60 ${className}`}
      >
        <span className="font-medium text-text tabular-nums">
          Разобрано {resolved} из {total}
        </span>
        {shown.map((verdict) => (
          <VerdictChip
            key={verdict}
            verdict={verdict}
            count={counts.get(verdict) ?? 0}
          />
        ))}
        <span className="text-accent underline decoration-dotted">открыть</span>
      </button>
    );
  }

  return (
    <div
      className={`w-full rounded-md border-2 border-amber-600 bg-amber-50 px-1.5 py-1 ${className}`}
    >
      <button
        type="button"
        onClick={() => openReviews(projectId)}
        title="Открыть разобранные замечания в отдельной вкладке"
        className="flex w-full items-center justify-between gap-1 pto-t-sm font-medium text-text hover:text-accent"
      >
        <span className="tabular-nums">
          Разобрано {resolved} из {total}
        </span>
        <span className="pto-t-xs text-accent underline decoration-dotted">
          открыть
        </span>
      </button>
      {shown.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {shown.map((verdict) => (
            <VerdictChip
              key={verdict}
              verdict={verdict}
              count={counts.get(verdict) ?? 0}
              onClick={() => openReviews(projectId, verdict)}
            />
          ))}
        </div>
      ) : (
        <div className="mt-0.5 pto-t-sm text-muted">
          Поставьте статус в таблице — итоги появятся здесь
        </div>
      )}
    </div>
  );
}
