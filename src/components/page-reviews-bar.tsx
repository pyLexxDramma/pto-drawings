"use client";

import type { ReactNode } from "react";
import { normalizeQuote } from "@/lib/remark-jump";
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
  onOpenReviews?: () => void;
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
    <div className="shrink-0 border-b border-sem-issue-line bg-sem-issue-soft pto-t-sm leading-snug text-sem-issue-text">
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium hover:text-sem-issue"
          title={open ? "Свернуть список замечаний" : "Показать замечания листа"}
        >
          <span className="shrink-0">{open ? "▾" : "▸"}</span>
          <span className="shrink-0">Замечаний по листу: {reviews.length}</span>
          <span className="min-w-0 truncate font-normal opacity-70">
            {open
              ? "· клик по строке подсветит место"
              : activeReview
                ? `· № ${activeReview.number} ${
                    activeReview.text || activeReview.aiFinding || ""
                  }`
                : "· нажмите, чтобы раскрыть список"}
          </span>
        </button>
        {!open && activeReview ? renderPlaceChips(activeReview) : null}
        {onOpenReviews ? (
          <button
            type="button"
            onClick={onOpenReviews}
            className="shrink-0 rounded border border-sem-issue-line bg-white px-1.5 py-0.5 pto-t-sm font-semibold text-sem-issue-text hover:bg-sem-issue-soft"
          >
            В таблице
          </button>
        ) : null}
      </div>
      {open ? (
        <ul className="max-h-40 overflow-auto border-t border-sem-issue-line/60">
          {reviews.map((review) => (
            <li
              key={review.id}
              className={`flex w-full items-start gap-1 px-2 py-1 ${
                isActive(review)
                  ? "bg-sem-issue-soft outline outline-1 outline-sem-issue"
                  : "hover:bg-white/60"
              }`}
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
                {` · ${REVIEW_SEVERITY_LABEL[review.severity].toLowerCase()} · ${
                  review.text || review.aiFinding
                }`}
              </button>
              {renderPlaceChips(review)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
