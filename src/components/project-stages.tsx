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

/**
 * Оба этапа на одном accent: sky и violet раньше выглядели как два разных
 * статуса, хотя это просто две страницы — какая открыта, говорит заливка, а
 * какой это этап, говорит подпись. Освободившиеся цвета ушли под смыслы.
 */
const STAGE_TAB: Record<
  StageId,
  { idle: string; current: string; track: "accent" | "emerald" }
> = {
  transcribe: {
    idle:
      "border-2 border-accent/40 bg-white text-text hover:border-accent hover:bg-accent/5",
    current:
      "border-2 border-accent bg-accent text-white shadow-sm hover:bg-[#1d4ed8]",
    track: "accent",
  },
  reviews: {
    idle:
      "border-2 border-accent/40 bg-white text-text hover:border-accent hover:bg-accent/5",
    current:
      "border-2 border-accent bg-accent text-white shadow-sm hover:bg-[#1d4ed8]",
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
      // «32/32» читалось как «нашли 32 из 32»: числа подписываем прямо в полосе,
      // подсказку под курсором на демо никто не наводит (баг 0099).
      count:
        pagesTotal > 0
          ? `листов ${pagesReady} из ${pagesTotal}`
          : filesTotal === 0
            ? "нет файлов"
            : "режем на листы",
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
          // «0/2» на демо прочли как «нашлось 0 замечаний из 2». Первым числом
          // ставим сколько замечаний всего, вторым — сколько разобрано.
          count:
            reviewsTotal > 0
              ? `${reviewsTotal} · разобрано ${reviewsDone}`
              : "ещё нет",
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
              : `Замечаний в проекте: ${reviewsTotal}, разобрано с заказчиком: ${reviewsDone}`,
        },
  ];
}

/**
 * Только этапы: на всю ширину шапки от логотипа до Админ.
 */
export function ProjectStagesBar({
  projectName,
  documents,
  documentsReady,
  reviews,
  reviewsOpen,
  onOpenStage,
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
  docOpen?: boolean;
  docTitle?: string | null;
  onBackHome?: () => void;
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
      className={`flex min-w-0 flex-1 items-center gap-2 overflow-hidden ${
        embedded ? "" : "shrink-0 border-b border-border bg-white px-2 py-0.5 sm:px-3"
      }`}
    >
      <span
        className="hidden max-w-[8rem] shrink-0 truncate pto-t-sm font-medium uppercase tracking-wide text-muted xl:inline"
        title={projectName}
      >
        {projectName}
      </span>

      <div className="flex min-w-0 flex-1 items-stretch gap-2">
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
              className={`flex min-w-0 flex-1 flex-col justify-center rounded-md border px-2 py-0.5 text-left disabled:cursor-default ${
                current ? tone.current : tone.idle
              }`}
            >
              <span className="flex items-baseline gap-1.5">
                <span className="truncate pto-t-md font-semibold leading-tight">
                  {stage.label}
                </span>
                <span
                  className={`truncate pto-t-sm tabular-nums ${
                    current ? "text-white/90" : "opacity-75"
                  }`}
                >
                  {stage.count}
                  {stage.state === "done" ? " ✓" : ""}
                </span>
              </span>
              <ProgressTrack
                className={`mt-0.5 h-0.5 ${current ? "opacity-90" : ""}`}
                value={stage.percent}
                tone={stage.state === "done" ? "emerald" : tone.track}
              />
            </button>
          );
        })}
      </div>

      {backLabel && onBackHome ? (
        <button
          type="button"
          onClick={onBackHome}
          title="Туда, откуда открыли эту страницу"
          className="shrink-0 rounded-md border-2 border-amber-500 bg-amber-500 px-2 py-0.5 pto-t-sm font-bold text-white shadow-sm hover:bg-amber-600"
        >
          {backLabel}
        </button>
      ) : null}

      {docTitle ? (
        <span
          className="hidden max-w-[20rem] shrink truncate rounded border border-slate-300 bg-white px-1.5 py-0.5 pto-t-sm font-medium text-slate-800 lg:inline"
          title={docTitle}
        >
          {docTitle}
        </span>
      ) : null}

      {busy ? <Spinner className="h-3.5 w-3.5 shrink-0 text-sky-700" /> : null}
    </div>
  );
}
