"use client";

import { useState, type ReactNode } from "react";
import { IconArrowRight, IconClose, IconTriangleLeft } from "@/components/tool-icons";
import { remarkWording } from "@/lib/sheet-label";
import {
  REVIEW_SEVERITY_LABEL,
  type Review,
} from "@/types";

const WRONG_TAGS = [
  "Такого в чертеже нет",
  "Не то место в ПД",
  "Числа сходятся",
  "Дубль другого замечания",
  "Формулировка мимо",
];

/** Одна форма и у очереди, и у выбранной строки листа. Без текста не сохраняется. */
export function WrongReasonForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy?: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="border-t border-rose-200 bg-white px-2 py-2">
      <div className="mb-1 font-medium text-rose-900">Почему ложное?</div>
      <textarea
        autoFocus
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Что неверно…"
        className="w-full resize-none rounded-md border border-border px-2 py-1 text-xs outline-none focus:border-accent"
      />
      <div className="mt-1 flex flex-wrap gap-1">
        {WRONG_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() =>
              setReason((prev) => (prev.trim() ? `${prev.trim()}. ${tag}` : tag))
            }
            className="rounded-full border border-rose-200 px-2 py-0.5 pto-t-xs text-rose-800 hover:bg-rose-50"
          >
            {tag}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy || !reason.trim()}
          onClick={() => {
            const text = reason.trim();
            if (!text) return;
            onSubmit(text);
          }}
          className="rounded-md bg-rose-600 px-2 py-1 font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
        >
          Сохранить
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-2 py-1 text-text"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

/**
 * Очередь подтверждения находок конвейера: принять / ложное / в таблицу,
 * без поиска глазами в общей куче.
 */
export function AiReviewQueueCard({
  review,
  index,
  total,
  busy,
  onPrev,
  onNext,
  canPrev,
  canNext,
  onAccept,
  onWrong,
  onEdit,
  onClose,
  leading,
  trailing,
}: {
  review: Review;
  index: number;
  total: number;
  busy?: boolean;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  onAccept: () => void;
  onWrong: (reason: string) => void;
  onEdit: () => void;
  onClose: () => void;
  /** Поиск: в одной полосе с разбором, а не строкой выше. */
  leading?: ReactNode;
  /** Свернуть текст: две стрелки, отдельно от перехода к ошибке. */
  trailing?: ReactNode;
}) {
  const [wrongOpen, setWrongOpen] = useState(false);
  const quote = (
    review.locations.find((item) => item.quote)?.quote ||
    review.text ||
    review.aiFinding ||
    ""
  ).trim();

  return (
    <div
      className="shrink-0 border-b border-accent/20 bg-accent/5 pto-t-sm text-text"
      data-ai-queue=""
    >
      <div className="flex flex-col gap-0.5 px-1.5 py-0.5">
        <div className="flex h-6 min-w-0 items-center gap-1">
          {leading}
          <div className="flex min-w-0 flex-1 items-center gap-x-1.5 overflow-hidden leading-none">
            <span className="shrink-0 font-semibold text-text">Разбор ИИ</span>
            {index >= 0 ? (
              <span className="shrink-0 tabular-nums text-muted">
                {index + 1} из {total}
              </span>
            ) : null}
            <span className="shrink-0 font-semibold tabular-nums">
              № {review.number}
            </span>
            <span className="min-w-0 truncate text-muted">
              {REVIEW_SEVERITY_LABEL[review.severity].toLowerCase()}
              {" · "}
              {quote
                ? remarkWording(quote)
                : remarkWording(review.text || review.aiFinding || "—")}
            </span>
          </div>
          {trailing}
        </div>
        <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={onAccept}
          className="shrink-0 rounded-md bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Принять
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setWrongOpen(true)}
          className="shrink-0 rounded-md border border-rose-300 bg-white px-2 py-1 font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-50"
        >
          Отклонить
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onEdit}
          className="shrink-0 rounded-md border border-border bg-white px-2 py-1 font-medium text-text hover:bg-surface-2 disabled:opacity-50"
        >
          В таблице
        </button>
        <button
          type="button"
          disabled={!canPrev || busy}
          onClick={onPrev}
          title="Предыдущая находка ИИ (↑)"
          aria-label="Предыдущая находка ИИ"
          className="shrink-0 rounded border border-border bg-white px-1 py-1 text-text hover:bg-surface-2 disabled:opacity-40"
        >
          <IconTriangleLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!canNext || busy}
          onClick={onNext}
          title="Следующая находка ИИ (↓)"
          aria-label="Следующая находка ИИ"
          className="shrink-0 rounded border border-border bg-white px-1 py-1 text-text hover:bg-surface-2 disabled:opacity-40"
        >
          <IconArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Закрыть разбор ИИ"
          aria-label="Закрыть разбор ИИ"
          onClick={onClose}
          className="shrink-0 rounded p-0.5 text-muted hover:bg-accent/10 hover:text-text"
        >
          <IconClose className="h-3.5 w-3.5" />
        </button>
        </div>
      </div>
      {wrongOpen ? (
        <WrongReasonForm
          busy={busy}
          onSubmit={(text) => {
            onWrong(text);
            setWrongOpen(false);
          }}
          onCancel={() => setWrongOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** Кнопка входа в очередь, когда режим ещё не включён. */
export function AiQueueEntryButton({
  count,
  onStart,
}: {
  count: number;
  onStart: () => void;
}) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onStart}
      title="Разобрать находки конвейера по одной"
      className="inline-flex h-6 shrink-0 items-center rounded-md border border-accent/40 bg-accent/5 px-2 pto-t-sm font-semibold text-accent hover:bg-accent/10"
      data-ai-queue-entry=""
    >
      Разбор ИИ · {count}
    </button>
  );
}
