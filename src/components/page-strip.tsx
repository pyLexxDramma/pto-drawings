"use client";

import { Tooltip } from "@/components/tooltip";
import { PaneToggle } from "@/components/ui-chrome";
import { VERDICT_CHIP } from "@/lib/review-colors";
import {
  KIND_LABEL,
  REVIEW_VERDICT_LABEL,
  type PageKind,
  type ReviewVerdict,
} from "@/types";

function StatusChip({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <Tooltip label={label}>
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-sm ${className}`}
        aria-label={label}
      />
    </Tooltip>
  );
}

type SheetRowProps = {
  pageNumber: number;
  current: boolean;
  kindLabel: string;
  isReady: boolean;
  isWorking: boolean;
  isUnseen: boolean;
  isFlagged: boolean;
  isEdited: boolean;
  dots?: { count: number; verdict: ReviewVerdict; pending: number };
  onSelect: (page: number) => void;
};

function SheetRow({
  pageNumber,
  current,
  kindLabel,
  isReady,
  isWorking,
  isUnseen,
  isFlagged,
  isEdited,
  dots,
  onSelect,
}: SheetRowProps) {
  const fallback = [
    isWorking ? "сейчас обрабатывается" : isReady ? "текст готов" : "ждёт текст",
    isUnseen ? "не открывали" : null,
    dots
      ? `${dots.count} · ${REVIEW_VERDICT_LABEL[dots.verdict].toLowerCase()}`
      : isFlagged
        ? "есть отметка"
        : isEdited
          ? "лист правили"
          : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const openIssues = (dots?.pending ?? 0) > 0;
  const allResolved = Boolean(dots && dots.count > 0 && dots.pending === 0);

  return (
    <button
      type="button"
      data-page={pageNumber}
      aria-current={current ? "page" : undefined}
      aria-label={`Лист ${pageNumber}, ${kindLabel}${fallback ? `. ${fallback}` : ""}`}
      onClick={() => onSelect(pageNumber)}
      className={`mb-0.5 flex w-full flex-col rounded-md border px-1.5 py-0.5 text-left [-webkit-tap-highlight-color:transparent] ${
        current
          ? // Открытый лист — заливкой, а не оттенком рамки: на тонкой рамке
            // оттенок не читался, а толщина сдвигала бы весь список при
            // листании с клавиатуры. Accent здесь значит «вы находитесь тут».
            "border-accent bg-accent/10 font-semibold"
          : isWorking
            ? "pto-page-working border-sky-400 bg-sky-50"
            : openIssues
              ? "border-amber-500 bg-amber-50 hover:border-amber-600 hover:bg-amber-100"
              : allResolved
                ? "border-emerald-600 bg-emerald-100 hover:border-emerald-700 hover:bg-emerald-200"
                : "border-emerald-400 bg-white hover:border-emerald-600 hover:bg-emerald-100"
      }`}
    >
      <span className="flex w-full items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate pto-t-sm font-medium leading-tight tabular-nums">
          L{pageNumber}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {isWorking ? (
            <StatusChip
              className="animate-pulse bg-accent motion-reduce:animate-none"
              label="Сейчас обрабатывается"
            />
          ) : dots || isReady ? null : (
            <StatusChip className="bg-slate-300" label="Ждёт текст" />
          )}
          {isUnseen ? (
            <StatusChip
              className="outline outline-1 outline-sky-500 bg-sky-100"
              label="Лист не открывали"
            />
          ) : null}
          {dots ? (
            <span
              className={`inline-flex max-w-full items-center gap-0.5 truncate rounded-md border px-1 py-px pto-t-xs font-semibold leading-4 ${
                openIssues ? VERDICT_CHIP.pending : VERDICT_CHIP[dots.verdict]
              }`}
              title={
                openIssues
                  ? `${dots.pending} не разобрано из ${dots.count}`
                  : `${dots.count} · ${REVIEW_VERDICT_LABEL[dots.verdict]}`
              }
            >
              <span className="truncate">
                {openIssues
                  ? REVIEW_VERDICT_LABEL.pending
                  : REVIEW_VERDICT_LABEL[dots.verdict]}
              </span>
              <span className="tabular-nums">
                {openIssues ? dots.pending : dots.count}
              </span>
            </span>
          ) : isFlagged ? (
            <StatusChip className="bg-sem-issue" label="Есть отметка" />
          ) : isEdited ? (
            <StatusChip className="outline outline-1 outline-slate-400 bg-slate-200" label="Лист правили" />
          ) : null}
        </span>
      </span>
    </button>
  );
}

type PageStripProps = {
  total: number;
  current: number;
  kinds: Map<number, PageKind>;
  edited: Set<number>;
  viewed: Set<number>;
  pageDots?: Map<number, { count: number; verdict: ReviewVerdict; pending: number }>;
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
          ? "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border-2 border-emerald-600 bg-emerald-50"
          : "flex h-full min-h-0 shrink-0 flex-col border-r-2 border-emerald-600 bg-emerald-50"
      }
      style={embedded ? undefined : { width }}
      data-page-strip
    >
      {embedded ? (
        <div className="shrink-0 border-b-2 border-emerald-600 bg-emerald-100 px-2 py-1 pto-t-sm font-semibold text-emerald-950">
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
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {pages.length === 0 && emptyLabel ? (
          <div className="px-1 py-2 pto-t-sm leading-snug text-muted">
            {emptyLabel}
          </div>
        ) : null}
        {pages.map((pageNumber) => {
          const kind = kinds.get(pageNumber);
          const isWorking = processingPage === pageNumber;
          const isReady = ready.has(pageNumber);
          return (
            <SheetRow
              key={pageNumber}
              pageNumber={pageNumber}
              current={current === pageNumber}
              kindLabel={
                kind ? KIND_LABEL[kind] : isWorking ? "сейчас" : "лист"
              }
              isReady={isReady}
              isWorking={isWorking}
              isUnseen={isReady && !isWorking && !viewed.has(pageNumber)}
              isFlagged={annotated?.has(pageNumber) ?? false}
              isEdited={edited.has(pageNumber)}
              dots={pageDots?.get(pageNumber)}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </div>
  );
}
