"use client";

import { ProgressTrack, Spinner } from "@/components/ui-chrome";
import type { DocumentRecord } from "@/types";

export type ReviewStats = { total: number; pending: number };

type StageState = "waiting" | "active" | "done";

type Stage = {
  id: string;
  label: string;
  /** Короткая подпись справа: сколько сделано. */
  count: string;
  percent: number;
  state: StageState;
  hint: string;
};

const DOT: Record<StageState, string> = {
  waiting: "border-slate-300 bg-white text-muted",
  active: "border-sky-400 bg-sky-100 text-sky-900",
  done: "border-emerald-400 bg-emerald-100 text-emerald-900",
};

function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

/**
 * Этапы проекта: Обработка → Расшифровка → Замечания. Нужны, чтобы на дейли
 * было видно, где проект стоит, без открытия каждого файла.
 */
export function ProjectStages({
  documents,
  reviews,
  reviewsOpen,
  onOpenReviews,
}: {
  documents: DocumentRecord[];
  /** null — ещё не загрузили счётчик замечаний. */
  reviews: ReviewStats | null;
  reviewsOpen: boolean;
  onOpenReviews: () => void;
}) {
  const filesTotal = documents.length;
  // Лист появляется только после нарезки, поэтому pageCount и есть признак обработки.
  const filesSliced = documents.filter((doc) => doc.pageCount > 0).length;
  const pagesTotal = documents.reduce((sum, doc) => sum + doc.pageCount, 0);
  const pagesReady = documents.reduce((sum, doc) => sum + doc.readyPages, 0);
  const busy = documents.some(
    (doc) => doc.status === "queued" || doc.status === "processing",
  );

  const reviewsTotal = reviews?.total ?? 0;
  const reviewsDone = reviews ? reviews.total - reviews.pending : 0;

  const stages: Stage[] = [
    {
      id: "intake",
      label: "Обработка",
      count: filesTotal > 0 ? `${filesSliced}/${filesTotal}` : "—",
      percent: percent(filesSliced, filesTotal),
      state:
        filesTotal === 0
          ? "waiting"
          : filesSliced === filesTotal
            ? "done"
            : "active",
      hint:
        filesTotal === 0
          ? "Загрузите файлы проекта"
          : `Файлов нарезано на листы: ${filesSliced} из ${filesTotal}`,
    },
    {
      id: "transcribe",
      label: "Расшифровка",
      count: pagesTotal > 0 ? `${pagesReady}/${pagesTotal}` : "—",
      percent: percent(pagesReady, pagesTotal),
      state:
        pagesTotal === 0
          ? "waiting"
          : pagesReady >= pagesTotal
            ? "done"
            : "active",
      hint:
        pagesTotal === 0
          ? "Ждём обработку файлов"
          : `Листов расшифровано: ${pagesReady} из ${pagesTotal}`,
    },
    {
      id: "reviews",
      label: "Замечания",
      count: reviewsTotal > 0 ? `${reviewsDone}/${reviewsTotal}` : "—",
      percent: percent(reviewsDone, reviewsTotal),
      state:
        reviewsTotal === 0
          ? "waiting"
          : reviewsDone >= reviewsTotal
            ? "done"
            : "active",
      hint:
        reviews === null
          ? "Считаем замечания…"
          : reviewsTotal === 0
            ? "Замечаний пока нет — конвейер их ещё не присылал"
            : `Разобрано с заказчиком: ${reviewsDone} из ${reviewsTotal}`,
    },
  ];

  return (
    <div className="mb-1.5 rounded-md border border-slate-300 bg-white/70 px-2 py-1.5">
      <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted">
        Этапы
        {busy ? <Spinner className="h-2.5 w-2.5 text-sky-700" /> : null}
      </div>
      <ol className="space-y-1">
        {stages.map((stage, index) => {
          const isReviews = stage.id === "reviews";
          const body = (
            <>
              <div className="flex items-center gap-1.5">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold tabular-nums ${
                    DOT[stage.state]
                  }`}
                  aria-hidden
                >
                  {stage.state === "done" ? "✓" : index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                  {stage.label}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted">
                  {stage.count}
                </span>
              </div>
              <ProgressTrack
                className="mt-1 h-1"
                value={stage.percent}
                tone={stage.state === "done" ? "accent" : "sky"}
              />
            </>
          );

          if (!isReviews) {
            return (
              <li key={stage.id} className="px-0.5 text-text" title={stage.hint}>
                {body}
              </li>
            );
          }
          return (
            <li key={stage.id}>
              <button
                type="button"
                onClick={onOpenReviews}
                title={`${stage.hint} · открыть таблицу`}
                aria-current={reviewsOpen ? "page" : undefined}
                className={`w-full rounded px-0.5 py-0.5 text-left ${
                  reviewsOpen
                    ? "bg-accent/10 text-accent"
                    : "text-text hover:bg-slate-200/70"
                }`}
              >
                {body}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
