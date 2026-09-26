"use client";

import type { ReactNode } from "react";
import {
  IconChevronDown,
  IconChevronRight,
  IconGrid,
} from "@/components/tool-icons";
import { normalizeQuote } from "@/lib/remark-jump";
import { SEVERITY_ITEM } from "@/lib/review-colors";
import { remarkWording } from "@/lib/sheet-label";
import { REVIEW_SEVERITY_LABEL, type Review } from "@/types";

/**
 * Полоса замечаний текущего листа над расшифровкой. Вынесено из review-pane:
 * там это лежало внутри пятиуровневого тернарника на 2000 строк, и любая правка
 * рядом рисковала уронить сборку на закрывающей стопке `</> )}`.
 */
export function PageReviewsBar({
  reviews,
  open,
  focusQuote,
  activeReview,
  renderPlaceChips,
  onToggle,
  onFocusReview,
  onOpenReviews,
}: {
  reviews: Review[];
  open: boolean;
  /** Цитата, подсвеченная сейчас — по ней определяем активную строку. */
  focusQuote: string;
  activeReview: Review | null;
  renderPlaceChips: (review: Review) => ReactNode;
  onToggle: () => void;
  onFocusReview: (review: Review) => void;
  onOpenReviews?: (reviewId?: string) => void;
}) {
  if (!reviews.length) return null;

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
          <span className="shrink-0">Замечаний по листу: {reviews.length}</span>
          {!open && activeReview ? (
            <span className="min-w-0 truncate font-normal opacity-70">
              · № {activeReview.number}{" "}
              {remarkWording(activeReview.text || activeReview.aiFinding || "")}
            </span>
          ) : null}
        </button>
        {!open && activeReview ? renderPlaceChips(activeReview) : null}
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
      {open ? (
        <ul className="max-h-40 space-y-1 overflow-auto border-t border-border px-1.5 py-1.5">
          {reviews.map((review) => (
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
          ))}
        </ul>
      ) : null}
    </div>
  );
}
