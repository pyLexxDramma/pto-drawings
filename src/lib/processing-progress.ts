import type { DocumentRecord, ProcessingStep } from "@/types";

/** Доля текущего листа по стадии конвейера (0..1). */
const STEP_FRACTION: Record<ProcessingStep, number> = {
  queued: 0.04,
  text: 0.38,
  drawings: 0.72,
  done: 1,
};

/** Если ещё нет готовых листов — оценка длительности одного листа, сек. */
const FALLBACK_SEC_PER_PAGE = 240;

export type ProgressInput = Pick<
  DocumentRecord,
  | "status"
  | "pageCount"
  | "readyPages"
  | "processingPage"
  | "processingStep"
  | "pipelineElapsedSec"
>;

export type PageProgressRow = {
  pageNumber: number;
  percent: number;
  status: "done" | "active" | "pending" | "error";
  elapsedSec: number | null;
  etaSec: number | null;
  label: string;
};

/**
 * Непрерывный процент обработки: готовые листы + прогресс текущего листа
 * (стадия + время), а не скачок 0→33→66→100.
 */
export function processingPercent(doc: ProgressInput): number {
  const total = Math.max(doc.pageCount, 1);
  const ready = Math.min(Math.max(doc.readyPages, 0), total);

  if (doc.status === "done") return 100;
  if (doc.status !== "queued" && doc.status !== "processing") {
    return Math.round((ready / total) * 1000) / 10;
  }

  const { currentFrac } = currentPageFraction(doc, ready, total);
  const raw = ((ready + currentFrac) / total) * 100;
  return Math.min(99.5, Math.round(raw * 10) / 10);
}

function currentPageFraction(doc: ProgressInput, ready: number, total: number) {
  if (ready >= total) {
    return { currentFrac: 0, spentOnCurrent: 0, avgSec: FALLBACK_SEC_PER_PAGE };
  }

  const stepFrac = doc.processingStep
    ? (STEP_FRACTION[doc.processingStep] ?? 0.2)
    : doc.status === "queued"
      ? 0.02
      : 0.15;

  const elapsed =
    typeof doc.pipelineElapsedSec === "number" && doc.pipelineElapsedSec > 0
      ? doc.pipelineElapsedSec
      : 0;
  const avgSec =
    ready > 0 && elapsed > 0
      ? Math.max(30, elapsed / ready)
      : FALLBACK_SEC_PER_PAGE;
  const spentOnCurrent = Math.max(0, elapsed - avgSec * ready);
  const timeFrac = Math.min(0.92, spentOnCurrent / avgSec);
  const currentFrac = Math.min(0.95, Math.max(stepFrac, timeFrac * 0.9));

  return { currentFrac, spentOnCurrent, avgSec };
}

/** Оценка оставшихся секунд до конца документа. */
export function processingEtaSec(doc: ProgressInput): number | null {
  if (doc.status === "done") return 0;
  if (doc.status !== "queued" && doc.status !== "processing") return null;

  const total = Math.max(doc.pageCount, 1);
  const ready = Math.min(Math.max(doc.readyPages, 0), total);
  if (ready >= total) return 0;

  const { currentFrac, avgSec } = currentPageFraction(doc, ready, total);
  const remainingPages = total - ready - currentFrac;
  return Math.max(0, Math.round(remainingPages * avgSec));
}

/** Прогресс по каждому листу для UI. */
export function pageProgressRows(
  doc: ProgressInput,
  pageErrors?: Record<string, string> | null,
): PageProgressRow[] {
  const total = Math.max(doc.pageCount, 1);
  const ready = Math.min(Math.max(doc.readyPages, 0), total);
  const elapsed =
    typeof doc.pipelineElapsedSec === "number" && doc.pipelineElapsedSec > 0
      ? doc.pipelineElapsedSec
      : 0;
  const { currentFrac, spentOnCurrent, avgSec } = currentPageFraction(
    doc,
    ready,
    total,
  );
  const activePage =
    doc.processingPage && doc.processingPage > 0
      ? doc.processingPage
      : ready < total
        ? ready + 1
        : null;

  const rows: PageProgressRow[] = [];
  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    const error = pageErrors?.[String(pageNumber)];
    if (error) {
      rows.push({
        pageNumber,
        percent: pageNumber <= ready ? 100 : 0,
        status: "error",
        elapsedSec: pageNumber <= ready ? Math.round(avgSec) : null,
        etaSec: null,
        label: "ошибка",
      });
      continue;
    }

    if (pageNumber <= ready) {
      rows.push({
        pageNumber,
        percent: 100,
        status: "done",
        elapsedSec: Math.round(avgSec),
        etaSec: 0,
        label: "готово",
      });
      continue;
    }

    if (
      (doc.status === "queued" || doc.status === "processing") &&
      activePage === pageNumber
    ) {
      const percent = Math.round(currentFrac * 1000) / 10;
      const etaSec = Math.max(0, Math.round(avgSec * (1 - currentFrac)));
      rows.push({
        pageNumber,
        percent,
        status: "active",
        elapsedSec: Math.round(spentOnCurrent),
        etaSec,
        label: stepShortLabel(doc.processingStep),
      });
      continue;
    }

    rows.push({
      pageNumber,
      percent: 0,
      status: "pending",
      elapsedSec: null,
      etaSec:
        doc.status === "queued" || doc.status === "processing"
          ? Math.round(avgSec)
          : null,
      label: "ожидает",
    });
  }

  // Если elapsed ещё 0, не показываем выдуманные секунды на готовых листах.
  if (elapsed <= 0) {
    for (const row of rows) {
      if (row.status === "done" || row.status === "active") {
        row.elapsedSec = row.status === "active" ? 0 : null;
      }
    }
  }

  return rows;
}

function stepShortLabel(step: ProcessingStep | null | undefined) {
  if (step === "text") return "текст";
  if (step === "drawings") return "чертёж";
  if (step === "queued") return "очередь";
  if (step === "done") return "готово";
  return "обработка";
}

export function formatProcessingPercent(value: number): string {
  if (value >= 100) return "100%";
  if (value < 10) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

export function formatProgressDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.round(sec)} с`;
  const minutes = Math.floor(sec / 60);
  const rest = Math.round(sec % 60);
  if (minutes < 60) return rest > 0 ? `${minutes} мин ${rest} с` : `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours} ч ${mins} мин` : `${hours} ч`;
}
