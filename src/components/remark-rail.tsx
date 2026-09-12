"use client";

import { PaneToggle } from "@/components/ui-chrome";
import { REVIEW_SEVERITY_LABEL, type Review } from "@/types";

export function RemarkRail({
  items,
  activeId,
  pageNumber,
  onSelect,
  onCollapse,
}: {
  items: Review[];
  activeId: string | null;
  pageNumber: number;
  onSelect: (review: Review) => void;
  onCollapse?: () => void;
}) {
  if (items.length === 0) return null;
  const index = Math.max(0, items.findIndex((item) => item.id === activeId));
  return (
    <aside
      data-remark-rail=""
      className="flex h-full w-[13.5rem] shrink-0 flex-col border-r border-border bg-white"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5 text-xs font-semibold text-text">
        <span className="min-w-0 flex-1 truncate">
          Замечания
          <span className="ml-1 font-normal tabular-nums text-muted">
            {items.length ? `${index + 1} из ${items.length}` : "0"}
          </span>
        </span>
        {onCollapse ? (
          <PaneToggle
            expanded
            align="left"
            expandLabel="Показать замечания"
            collapseLabel="Скрыть замечания"
            onToggle={onCollapse}
          />
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto p-1.5">
        {items.map((review, i) => {
          const onPage = review.locations.some((loc) => loc.pageNumber === pageNumber);
          const active = review.id === activeId;
          return (
            <button
              key={review.id}
              type="button"
              data-remark-id={review.id}
              onClick={() => onSelect(review)}
              className={`w-full rounded-md border px-2 py-1.5 text-left text-[11px] leading-snug ${
                active
                  ? "border-accent bg-accent/10"
                  : onPage
                    ? "border-rose-200 bg-rose-50"
                    : "border-border bg-white hover:bg-bg"
              }`}
            >
              <span className="font-semibold tabular-nums">№ {review.number}</span>
              <span className="ml-1 text-muted">
                {REVIEW_SEVERITY_LABEL[review.severity].toLowerCase()}
                {onPage ? "" : ` · л.${review.locations[0]?.pageNumber ?? "?"}`}
              </span>
              <div className="mt-0.5 line-clamp-3 text-text">
                {review.text || review.aiFinding}
              </div>
              <span className="sr-only">замечание {i + 1}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
