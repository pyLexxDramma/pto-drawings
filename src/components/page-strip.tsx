"use client";

import { Tooltip } from "@/components/tooltip";
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
    <Tooltip label={label}>
      <span className={`h-3 w-3 rounded-full ${className}`} aria-label={label} />
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
  dots?: { count: number; verdict: ReviewVerdict };
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

  return (
    <button
      type="button"
      data-page={pageNumber}
      aria-current={current ? "page" : undefined}
      aria-label={`Лист ${pageNumber}, ${kindLabel}${fallback ? `. ${fallback}` : ""}`}
      onClick={() => onSelect(pageNumber)}
      className={`mb-0.5 flex w-full flex-col gap-0.5 rounded px-1.5 py-1 text-left [-webkit-tap-highlight-color:transparent] ${
        current
          ? "bg-white ring-1 ring-accent/50"
          : isWorking
            ? "pto-page-working bg-sky-50"
            : "hover:bg-white"
      }`}
    >
      <span className="flex w-full items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate pto-t-sm font-medium leading-tight">
          Лист {pageNumber}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {isWorking ? (
            <StatusDot
              className="animate-pulse bg-accent motion-reduce:animate-none"
              label="Сейчас обрабатывается"
            />
          ) : isReady ? (
            <StatusDot className="bg-sem-ok" label="Текст готов" />
          ) : (
            <StatusDot className="bg-slate-300" label="Ждёт текст" />
          )}
          {isUnseen ? (
            <StatusDot
              className="border-2 border-sem-attn bg-sem-attn-soft"
              label="Лист не открывали"
            />
          ) : null}
          {dots ? (
            <Tooltip
              label={`${dots.count} · ${REVIEW_VERDICT_LABEL[dots.verdict].toLowerCase()}`}
            >
              <span
                className={`inline-flex min-w-[1.125rem] items-center justify-center rounded-full px-1 pto-t-xs font-semibold leading-[1.125rem] tabular-nums ${VERDICT_COUNT[dots.verdict]}`}
                aria-label={`${dots.count} · ${REVIEW_VERDICT_LABEL[dots.verdict]}`}
              >
                {dots.count}
              </span>
            </Tooltip>
          ) : isFlagged ? (
            <StatusDot className="bg-sem-issue" label="Есть отметка" />
          ) : isEdited ? (
            <StatusDot className="bg-sem-attn" label="Лист правили" />
          ) : null}
        </span>
      </span>
      {/* Подпись только у текущего листа: у остальных состояние объясняет
          тултип, а строка на каждый лист превращала полосу в простыню. */}
      {current && fallback ? (
        <span className="w-full text-pretty pto-t-xs leading-snug text-muted">
          {fallback}
        </span>
      ) : null}
    </button>
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
