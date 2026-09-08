"use client";

import { ProgressTrack, Spinner } from "@/components/ui-chrome";
import type { DocumentRecord } from "@/types";

export type ReviewStats = { total: number; pending: number };

type StageState = "waiting" | "active" | "done";

type Stage = {
  id: string;
  label: string;
  /** Короткая подпись: сколько сделано. */
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

function buildStages(
  documents: DocumentRecord[],
  reviews: ReviewStats | null,
): Stage[] {
  const filesTotal = documents.length;
  // Лист появляется только после нарезки, поэтому pageCount и есть признак обработки.
  const filesSliced = documents.filter((doc) => doc.pageCount > 0).length;
  const pagesTotal = documents.reduce((sum, doc) => sum + doc.pageCount, 0);
  const pagesReady = documents.reduce((sum, doc) => sum + doc.readyPages, 0);
  const reviewsTotal = reviews?.total ?? 0;
  const reviewsDone = reviews ? reviews.total - reviews.pending : 0;

  return [
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
}

/**
 * Полоса этапов проекта: Обработка → Расшифровка → Замечания. Нужна, чтобы на
 * дейли было видно, где проект стоит, без открытия каждого файла. Скрывается,
 * чтобы не отнимать высоту у чертежа.
 */
export function ProjectStagesBar({
  projectName,
  documents,
  /** null — ещё не загрузили счётчик замечаний. */
  reviews,
  reviewsOpen,
  collapsed,
  onToggleCollapsed,
  onOpenReviews,
}: {
  projectName: string;
  documents: DocumentRecord[];
  reviews: ReviewStats | null;
  reviewsOpen: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenReviews: () => void;
}) {
  const stages = buildStages(documents, reviews);
  const busy = documents.some(
    (doc) => doc.status === "queued" || doc.status === "processing",
  );

  if (collapsed) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-2 px-3 py-1">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex items-center gap-1.5 rounded border border-border bg-white px-2 py-0.5 text-[11px] text-muted hover:text-text"
          aria-expanded={false}
          title="Показать этапы проекта"
        >
          Этапы
          {busy ? <Spinner className="h-2.5 w-2.5 text-sky-700" /> : null}
        </button>
        {stages.map((stage) => (
          <span
            key={stage.id}
            className="whitespace-nowrap text-[11px] tabular-nums text-muted"
            title={stage.hint}
          >
            {stage.label} {stage.count}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-border bg-surface-2 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
          Этапы · {projectName}
        </span>
        {busy ? <Spinner className="h-2.5 w-2.5 text-sky-700" /> : null}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="ml-auto rounded border border-border bg-white px-2 py-0.5 text-[11px] text-muted hover:text-text"
          aria-expanded
          title="Свернуть этапы"
        >
          Скрыть
        </button>
      </div>
      <ol className="flex flex-wrap items-stretch gap-2">
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
                <span className="truncate text-[11px] font-medium">
                  {stage.label}
                </span>
                <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted">
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
              <li
                key={stage.id}
                title={stage.hint}
                className="min-w-[10rem] flex-1 rounded-md border border-slate-300 bg-white/70 px-2 py-1.5 text-text"
              >
                {body}
              </li>
            );
          }
          return (
            <li key={stage.id} className="min-w-[10rem] flex-1">
              <button
                type="button"
                onClick={onOpenReviews}
                title={`${stage.hint} · открыть таблицу`}
                aria-current={reviewsOpen ? "page" : undefined}
                className={`h-full w-full rounded-md border px-2 py-1.5 text-left ${
                  reviewsOpen
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-slate-300 bg-white/70 text-text hover:border-accent/60"
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
