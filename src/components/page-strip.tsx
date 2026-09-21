"use client";

import { PaneToggle } from "@/components/ui-chrome";
import { VERDICT_COUNT } from "@/lib/review-colors";
import {
  KIND_LABEL,
  REVIEW_VERDICT_LABEL,
  type PageKind,
  type ReviewVerdict,
} from "@/types";

function StatusDot({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span className="group/dot relative inline-flex" aria-label={label}>
      <span className={`h-3 w-3 rounded-full ${className}`} />
      <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden w-max max-w-[11rem] -translate-x-1/2 text-balance rounded bg-slate-900 px-1.5 py-0.5 pto-t-sm leading-snug text-white shadow-sm group-hover/dot:block">
        {label}
      </span>
    </span>
  );
}

type PageStripProps = {
  total: number;
  current: number;
  kinds: Map<number, PageKind>;
  edited: Set<number>;
  viewed: Set<number>;
  pageDots?: Map<number, { count: number; verdict: ReviewVerdict }>;
  ready: Set<number>;
  annotated?: Set<number>;
  hidden?: Set<number>;
  processingPage: number | null;
  width?: number;
  emptyLabel?: string;
  onSelect: (page: number) => void;
  onCollapse?: () => void;
  /** В колонке проектов: на всю ширину, без своей кнопки свернуть. */
  embedded?: boolean;
};

export function PageStrip({
  total,
  current,
  kinds,
  edited,
  viewed,
  pageDots,
  ready,
  annotated,
  hidden,
  processingPage,
  width = 108,
  emptyLabel,
  onSelect,
  onCollapse,
  embedded = false,
}: PageStripProps) {
  const pages = Array.from({ length: total }, (_, index) => index + 1).filter(
    (pageNumber) => !hidden?.has(pageNumber),
  );

  return (
    <div
      className={
        embedded
          ? "flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface-2"
          : "flex h-full min-h-0 shrink-0 flex-col border-r border-border bg-surface-2"
      }
      style={embedded ? undefined : { width }}
      data-page-strip
    >
      {embedded ? (
        <div className="shrink-0 border-b border-border px-2 py-1 pto-t-sm font-semibold text-muted">
          Листы
        </div>
      ) : onCollapse ? (
        <div className="flex shrink-0 items-center justify-end border-b border-border px-1 py-1">
          <PaneToggle
            expanded
            align="left"
            expandLabel="Показать список листов"
            collapseLabel="Скрыть список листов"
            onToggle={onCollapse}
          />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-visible p-1.5">
        {pages.length === 0 && emptyLabel ? (
          <div className="px-1 py-2 pto-t-sm leading-snug text-muted">
            {emptyLabel}
          </div>
        ) : null}
        {pages.map((pageNumber) => {
          const kind = kinds.get(pageNumber);
          const isEdited = edited.has(pageNumber);
          const dots = pageDots?.get(pageNumber);
          const isReady = ready.has(pageNumber);
          const isFlagged = annotated?.has(pageNumber) ?? false;
          const isWorking = processingPage === pageNumber;
          const isUnseen = isReady && !isWorking && !viewed.has(pageNumber);
          const kindLabel = kind
            ? KIND_LABEL[kind]
            : isWorking
              ? "сейчас"
              : "лист";
          return (
            <button
              key={pageNumber}
              type="button"
              data-page={pageNumber}
              aria-current={current === pageNumber ? "page" : undefined}
              onClick={() => onSelect(pageNumber)}
              title={`${kindLabel} ${pageNumber}`}
              className={`mb-0.5 flex w-full items-center gap-1.5 overflow-visible rounded px-1.5 py-1 text-left ${
                current === pageNumber
                  ? "bg-white ring-1 ring-accent/50"
                  : isWorking
                    ? "pto-page-working bg-sky-50"
                    : "hover:bg-white"
              }`}
            >
              <span className="min-w-0 flex-1 truncate pto-t-sm font-medium leading-tight">
                Лист {pageNumber}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 overflow-visible">
                {isWorking ? (
                  <StatusDot
                    className="animate-pulse bg-sky-500 motion-reduce:animate-none"
                    label="Сейчас обрабатывается"
                  />
                ) : isReady ? (
                  <StatusDot className="bg-emerald-500" label="Текст готов" />
                ) : (
                  <StatusDot className="bg-slate-300" label="Ждёт текст" />
                )}
                {isUnseen ? (
                  <StatusDot
                    className="border-2 border-amber-500 bg-amber-100"
                    label="Лист не открывали"
                  />
                ) : null}
                {dots ? (
                  <span
                    className={`group/dot relative inline-flex min-w-[1.125rem] items-center justify-center rounded-full px-1 pto-t-xs font-semibold leading-[1.125rem] tabular-nums ${VERDICT_COUNT[dots.verdict]}`}
                    aria-label={`${dots.count} · ${REVIEW_VERDICT_LABEL[dots.verdict]}`}
                  >
                    {dots.count}
                    <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden w-max max-w-[11rem] -translate-x-1/2 text-balance rounded bg-slate-900 px-1.5 py-0.5 pto-t-sm font-normal leading-snug text-white shadow-sm group-hover/dot:block">
                      {`${dots.count} · ${REVIEW_VERDICT_LABEL[dots.verdict].toLowerCase()}`}
                    </span>
                  </span>
                ) : isFlagged ? (
                  <StatusDot className="bg-red-500" label="Есть отметка" />
                ) : isEdited ? (
                  <StatusDot className="bg-amber-500" label="Лист правили" />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
