"use client";

import type { ReactNode } from "react";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconGrid,
} from "@/components/tool-icons";
import { normalizeQuote } from "@/lib/remark-jump";
import { SEVERITY_ITEM } from "@/lib/review-colors";
import { remarkWording } from "@/lib/sheet-label";
import {
  REVIEW_SEVERITY_LABEL,
  type Review,
  type ReviewSeverity,
} from "@/types";

const SEVERITY_CHIPS: ReviewSeverity[] = ["high", "medium", "low"];

/**
 * Полоса замечаний текущего листа над расшифровкой. Вынесено из review-pane:
 * там это лежало внутри пятиуровневого тернарника на 2000 строк, и любая правка
 * рядом рисковала уронить сборку на закрывающей стопке `</> )}`.
 */
export function PageReviewsBar({
  reviews,
  totalCount,
  open,
  focusQuote,
  activeReview,
  renderPlaceChips,
  onToggle,
  onFocusReview,
  onOpenReviews,
  pendingCount = 0,
  onPrevPending,
  onNextPending,
  canPrevPending = false,
  canNextPending = false,
  pinPendingOnly = false,
  pinAiOnly = false,
  pinSeverities,
  onTogglePinPending,
  onTogglePinAi,
  onTogglePinSeverity,
}: {
  reviews: Review[];
  /** Сколько на листе до фильтра пинов — для подписи «3 из 12». */
  totalCount?: number;
  open: boolean;
  /** Цитата, подсвеченная сейчас — по ней определяем активную строку. */
  focusQuote: string;
  activeReview: Review | null;
  renderPlaceChips: (review: Review) => ReactNode;
  onToggle: () => void;
  onFocusReview: (review: Review) => void;
  onOpenReviews?: (reviewId?: string) => void;
  pendingCount?: number;
  onPrevPending?: () => void;
  onNextPending?: () => void;
  canPrevPending?: boolean;
  canNextPending?: boolean;
  pinPendingOnly?: boolean;
  pinAiOnly?: boolean;
  pinSeverities?: Set<ReviewSeverity>;
  onTogglePinPending?: () => void;
  onTogglePinAi?: () => void;
  onTogglePinSeverity?: (severity: ReviewSeverity) => void;
}) {
  const total = totalCount ?? reviews.length;
  if (!total) return null;

  const filtersOn = Boolean(
    onTogglePinPending || onTogglePinAi || onTogglePinSeverity,
  );
  const severitySet = pinSeverities ?? new Set<ReviewSeverity>();

  /** Строка активна, если подсвечена её цитата или сама формулировка. */
  function isActive(review: Review) {
    if (focusQuote.length < 2) return false;
    const needle = normalizeQuote(focusQuote);
    return (
      review.locations.some(
        (loc) => loc.quote && normalizeQuote(loc.quote) === needle,
      ) ||
      normalizeQuote(review.text || "") === needle ||
      normalizeQuote(review.aiFinding || "") === needle
    );
  }

  const countLabel =
    reviews.length === total
      ? `Этот лист · ${total}`
      : `Этот лист · ${reviews.length} из ${total}`;

  return (
    /**
     * Полоса нейтральная: это счётчик, а не авария. Раньше она была розовой
     * плашкой состояния, и лист с замечаниями выглядел как упавшая обработка.
     * Про замечания говорит красная точка у числа.
     */
    <div className="shrink-0 border-b border-border bg-surface-2 pto-t-sm leading-snug text-text">
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium hover:text-accent"
          title={open ? "Свернуть список замечаний" : "Показать замечания листа"}
        >
          <span className="shrink-0">
            {open ? (
              <IconChevronDown className="h-3 w-3" />
            ) : (
              <IconChevronRight className="h-3 w-3" />
            )}
          </span>
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-sem-issue"
            aria-hidden
          />
          <span className="shrink-0">{countLabel}</span>
          {pendingCount > 0 ? (
            <span className="shrink-0 font-normal opacity-70">
              · не разобрано {pendingCount}
            </span>
          ) : null}
          {!open && activeReview ? (
            <span className="min-w-0 truncate font-normal opacity-70">
              · № {activeReview.number}{" "}
              {remarkWording(activeReview.text || activeReview.aiFinding || "")}
            </span>
          ) : null}
        </button>
        {!open && activeReview ? renderPlaceChips(activeReview) : null}
        {onPrevPending && onNextPending ? (
          <span className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              disabled={!canPrevPending}
              onClick={onPrevPending}
              title="Предыдущее неразобранное (↑)"
              aria-label="Предыдущее неразобранное"
              className="rounded border border-slate-300 bg-white px-1 py-1 text-slate-700 hover:bg-slate-50 hover:text-accent disabled:cursor-default disabled:opacity-40"
            >
              <IconChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!canNextPending}
              onClick={onNextPending}
              title="Следующее неразобранное (↓)"
              aria-label="Следующее неразобранное"
              className="rounded border border-slate-300 bg-white px-1 py-1 text-slate-700 hover:bg-slate-50 hover:text-accent disabled:cursor-default disabled:opacity-40"
            >
              <IconChevronRight className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : null}
        {onOpenReviews ? (
          <button
            type="button"
            onClick={() => onOpenReviews?.(activeReview?.id)}
            title={
              activeReview
                ? `Открыть замечание № ${activeReview.number} в таблице`
                : "Открыть таблицу замечаний"
            }
            aria-label={
              activeReview
                ? `Открыть замечание № ${activeReview.number} в таблице`
                : "Открыть таблицу замечаний"
            }
            className="shrink-0 rounded border border-slate-300 bg-white px-1.5 py-1 text-slate-700 hover:bg-slate-50 hover:text-accent"
          >
            <IconGrid className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {filtersOn ? (
        <div className="flex flex-wrap items-center gap-1 border-t border-border px-2 py-1">
          <span className="mr-0.5 text-muted">Пины:</span>
          <FilterChip
            active={pinPendingOnly}
            onClick={() => onTogglePinPending?.()}
            title="Только неразобранные"
          >
            Не разобрано
          </FilterChip>
          <FilterChip
            active={pinAiOnly}
            onClick={() => onTogglePinAi?.()}
            title="Только находки конвейера"
          >
            ИИ
          </FilterChip>
          {SEVERITY_CHIPS.map((severity) => (
            <FilterChip
              key={severity}
              active={severitySet.has(severity)}
              onClick={() => onTogglePinSeverity?.(severity)}
              title={REVIEW_SEVERITY_LABEL[severity]}
            >
              {REVIEW_SEVERITY_LABEL[severity]}
            </FilterChip>
          ))}
        </div>
      ) : null}
      {open ? (
        <ul className="max-h-40 space-y-1 overflow-auto border-t border-border px-1.5 py-1.5">
          {reviews.length === 0 ? (
            <li className="px-2 py-1 text-muted">
              Нет замечаний под текущий фильтр пинов.
            </li>
          ) : (
            reviews.map((review) => (
              <li
                key={review.id}
                className={`flex w-full items-start gap-1 rounded border px-2 py-1 ${
                  SEVERITY_ITEM[review.severity]
                } ${isActive(review) ? "outline outline-1 outline-slate-400" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => onFocusReview(review)}
                  className="min-w-0 flex-1 text-left"
                  title="Подсветить место на чертеже и в расшифровке"
                >
                  <span className="font-semibold tabular-nums">
                    № {review.number}
                  </span>
                  {` · ${REVIEW_SEVERITY_LABEL[review.severity].toLowerCase()} · ${remarkWording(
                    review.text || review.aiFinding || "",
                  )}`}
                </button>
                {renderPlaceChips(review)}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded border px-1.5 py-0.5 pto-t-xs font-medium ${
        active
          ? "border-sky-500 bg-sky-50 text-sky-900"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
