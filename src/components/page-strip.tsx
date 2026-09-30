"use client";

import { PaneToggle } from "@/components/ui-chrome";
import {
  KIND_LABEL,
  REVIEW_VERDICT_LABEL,
  type PageKind,
  type ReviewVerdict,
  type SheetCheck,
} from "@/types";

function checkLabel(check: SheetCheck): string {
  if (check.status === "checked") {
    return check.count > 0 ? `проверен · ${check.count}` : "проверен";
  }
  if (check.status === "error") return "ошибка";
  return "не проверен";
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
  check?: SheetCheck;
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
  check,
  onSelect,
}: SheetRowProps) {
  const status = check ? checkLabel(check) : null;
  const fallback = [
    isWorking ? "сейчас обрабатывается" : isReady ? "текст готов" : "ждёт текст",
    status,
    check?.reason || null,
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
            ? "pto-page-working border-accent bg-accent/5"
            : openIssues
              ? "border-amber-500 bg-amber-50 hover:border-amber-600 hover:bg-amber-100"
              : allResolved
                ? "border-emerald-600 bg-emerald-100 hover:border-emerald-700 hover:bg-emerald-200"
                : check?.status === "error"
                  ? "border-rose-400 bg-rose-50 hover:border-rose-500"
                  : // Замечаний нет — цвета нет. Зелёный значит только «разобрано»,
                  // и красить им каждый обычный лист значило бы обесценить его.
                  "border-border bg-white hover:border-accent/30 hover:bg-surface-2"
      }`}
    >
      <span className="flex w-full items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate pto-t-sm font-medium leading-tight tabular-nums">
          L{pageNumber}
        </span>
        {status || isWorking || !isReady ? (
          <span
            className={`shrink-0 truncate pto-t-xs font-semibold tabular-nums ${
              check?.status === "error"
                ? "text-rose-800"
                : check?.status === "checked"
                  ? "text-emerald-800"
                  : "text-muted"
            }`}
            title={check?.reason || undefined}
          >
            {status ?? (isWorking ? "обрабатывается" : "ждёт текст")}
          </span>
        ) : (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600"
            title="текст готов"
            aria-label="текст готов"
          />
        )}
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
  sheetChecks?: Map<number, SheetCheck>;
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
  sheetChecks,
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
          ? "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border-2 border-slate-300 bg-surface-2"
          : "flex h-full min-h-0 shrink-0 flex-col border-r-2 border-slate-300 bg-surface-2"
      }
      style={embedded ? undefined : { width }}
      data-page-strip
    >
      {embedded ? (
        <div className="shrink-0 border-b-2 border-slate-300 bg-slate-200 px-2 py-1 pto-t-sm font-semibold text-text">
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
              check={sheetChecks?.get(pageNumber)}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </div>
  );
}
