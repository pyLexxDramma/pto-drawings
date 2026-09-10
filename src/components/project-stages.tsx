"use client";

import { ProgressTrack, Spinner } from "@/components/ui-chrome";
import type { DocumentRecord } from "@/types";

export type ReviewStats = { total: number; pending: number };

/**
 * Нарезку архива на листы инженеру видеть незачем (решение Дархана 09.09):
 * этапов два — расшифровка и разбор замечаний.
 */
export type StageId = "transcribe" | "reviews";

type StageState = "waiting" | "active" | "done";

type Stage = {
  id: StageId;
  label: string;
  count: string;
  percent: number;
  state: StageState;
  hint: string;
};

const ACTION: Record<StageId, string> = {
  transcribe: "открыть первый нерасшифрованный лист",
  reviews: "открыть таблицу замечаний",
};

const STAGE_TAB: Record<
  StageId,
  { idle: string; current: string; track: "sky" | "accent" | "emerald" }
> = {
  transcribe: {
    idle:
      "border-teal-300 bg-teal-50 text-teal-950 hover:border-teal-500 hover:bg-teal-100",
    current:
      "border-teal-600 bg-teal-600 text-white shadow-sm hover:bg-teal-600",
    track: "sky",
  },
  reviews: {
    idle:
      "border-indigo-300 bg-indigo-50 text-indigo-950 hover:border-indigo-500 hover:bg-indigo-100",
    current:
      "border-indigo-600 bg-indigo-600 text-white shadow-sm hover:bg-indigo-600",
    track: "accent",
  },
};

function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

const PENDING: Omit<Stage, "id" | "label"> = {
  count: "…",
  percent: 0,
  state: "waiting",
  hint: "Загружаем…",
};

function buildStages(
  documents: DocumentRecord[],
  documentsReady: boolean,
  reviews: ReviewStats | null,
): Stage[] {
  if (!documentsReady) {
    return [
      { id: "transcribe", label: "Расшифровка", ...PENDING },
      { id: "reviews", label: "Таблица замечаний", ...PENDING },
    ];
  }

  const filesTotal = documents.length;
  const filesSliced = documents.filter((doc) => doc.pageCount > 0).length;
  const pagesTotal = documents.reduce((sum, doc) => sum + doc.pageCount, 0);
  const pagesReady = documents.reduce((sum, doc) => sum + doc.readyPages, 0);
  const reviewsTotal = reviews?.total ?? 0;
  const reviewsDone = reviews ? reviews.total - reviews.pending : 0;

  return [
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
        filesTotal === 0
          ? "Загрузите файлы проекта"
          : filesSliced < filesTotal
            ? `Файлы режем на листы: ${filesSliced} из ${filesTotal}`
            : `Листов расшифровано: ${pagesReady} из ${pagesTotal}`,
    },
    reviews === null
      ? { id: "reviews", label: "Таблица замечаний", ...PENDING }
      : {
          id: "reviews",
          label: "Таблица замечаний",
          count: reviewsTotal > 0 ? `${reviewsDone}/${reviewsTotal}` : "—",
          percent: percent(reviewsDone, reviewsTotal),
          state:
            reviewsTotal === 0
              ? "waiting"
              : reviewsDone >= reviewsTotal
                ? "done"
                : "active",
          hint:
            reviewsTotal === 0
              ? "Замечаний пока нет — конвейер их ещё не присылал"
              : `Разобрано с заказчиком: ${reviewsDone} из ${reviewsTotal}`,
        },
  ];
}

/**
 * Этапы + мелкие контролы. В шапке (embedded) растягивается на всю ширину.
 */
export function ProjectStagesBar({
  projectName,
  documents,
  documentsReady,
  reviews,
  reviewsOpen,
  onOpenStage,
  showProjectsChrome,
  projectsCollapsed,
  onToggleProjects,
  onNewProject,
  docOpen,
  docTitle,
  onBackHome,
  backLabel,
  embedded = false,
}: {
  projectName: string;
  documents: DocumentRecord[];
  documentsReady: boolean;
  reviews: ReviewStats | null;
  reviewsOpen: boolean;
  onOpenStage: (stage: StageId) => void;
  showProjectsChrome?: boolean;
  projectsCollapsed?: boolean;
  onToggleProjects?: () => void;
  onNewProject?: () => void;
  docOpen?: boolean;
  docTitle?: string | null;
  onBackHome?: () => void;
  /** Подпись кнопки «назад»; если null — кнопки нет. */
  backLabel?: string | null;
  embedded?: boolean;
}) {
  const stages = buildStages(documents, documentsReady, reviews);
  const busy =
    documentsReady &&
    documents.some(
      (doc) => doc.status === "queued" || doc.status === "processing",
    );

  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-2 ${
        embedded ? "" : "shrink-0 border-b border-border bg-white px-2 py-1.5 sm:px-3"
      }`}
    >
      <span
        className="hidden max-w-[9rem] shrink-0 truncate text-[10px] font-medium uppercase tracking-wide text-muted 2xl:inline"
        title={projectName}
      >
        {projectName}
      </span>

      <div className="flex min-w-0 flex-[2] items-stretch gap-2">
        {stages.map((stage) => {
          const current =
            (stage.id === "reviews" && reviewsOpen) ||
            (stage.id === "transcribe" && !reviewsOpen && Boolean(docOpen));
          const tone = STAGE_TAB[stage.id];
          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => onOpenStage(stage.id)}
              disabled={stage.count === PENDING.count}
              title={`${stage.hint} · ${ACTION[stage.id]}`}
              aria-current={current ? "page" : undefined}
              className={`flex min-w-0 flex-1 flex-col justify-center rounded-md border px-3 py-2 text-left disabled:cursor-default ${
                current ? tone.current : tone.idle
              }`}
            >
              <span className="flex items-baseline gap-2">
                <span className="truncate text-[13px] font-semibold leading-tight sm:text-sm">
                  {stage.label}
                </span>
                <span
                  className={`shrink-0 text-[11px] tabular-nums sm:text-xs ${
                    current ? "text-white/90" : "opacity-75"
                  }`}
                >
                  {stage.count}
                  {stage.state === "done" ? " ✓" : ""}
                </span>
              </span>
              <ProgressTrack
                className={`mt-1.5 h-1.5 ${current ? "opacity-90" : ""}`}
                value={stage.percent}
                tone={stage.state === "done" ? "emerald" : tone.track}
              />
            </button>
          );
        })}
      </div>

      <div className="hidden h-8 w-px shrink-0 bg-border sm:block" />

      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {showProjectsChrome ? (
          <>
            <button
              type="button"
              onClick={onToggleProjects}
              title={projectsCollapsed ? "Показать проекты" : "Скрыть проекты"}
              className="shrink-0 rounded border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-violet-900 hover:bg-violet-100"
            >
              Проекты
            </button>
            {onNewProject ? (
              <button
                type="button"
                onClick={onNewProject}
                title="Новый проект"
                className="shrink-0 rounded border border-fuchsia-300 bg-fuchsia-50 px-2 py-1 text-[11px] font-semibold text-fuchsia-900 hover:bg-fuchsia-100"
              >
                +
              </button>
            ) : null}
            {onToggleProjects ? (
              <button
                type="button"
                onClick={onToggleProjects}
                className="shrink-0 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
              >
                {projectsCollapsed ? "Показать" : "Скрыть"}
              </button>
            ) : null}
          </>
        ) : null}

        {backLabel && onBackHome ? (
          <button
            type="button"
            onClick={onBackHome}
            title={backLabel}
            className="shrink-0 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-950 hover:bg-amber-100"
          >
            {backLabel}
          </button>
        ) : null}

        {docTitle ? (
          <span
            className="min-w-0 truncate rounded border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-950"
            title={docTitle}
          >
            {docTitle}
          </span>
        ) : null}
      </div>

      {busy ? <Spinner className="h-3.5 w-3.5 shrink-0 text-sky-700" /> : null}
    </div>
  );
}
