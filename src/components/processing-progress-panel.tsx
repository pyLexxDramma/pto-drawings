"use client";

import { useMemo, useState } from "react";
import { ProgressTrack, Spinner } from "@/components/ui-chrome";
import { useSmoothProgress } from "@/hooks/use-smooth-progress";
import {
  formatProcessingPercent,
  formatProgressDuration,
  pageProgressRows,
  processingEtaSec,
  processingPercent,
  type ProgressInput,
} from "@/lib/processing-progress";

type DocProgress = ProgressInput & {
  originalName?: string;
  pageErrors?: Record<string, string> | null;
  errorMessage?: string | null;
  pipelineMode?: "mock" | "real" | null;
  pipelineModel?: string | null;
};

type ProcessingProgressPanelProps = {
  document: DocProgress;
  canceling?: boolean;
  onCancel?: () => void;
};

function isCancelMessage(message: string | null | undefined) {
  return Boolean(message && message.startsWith("Отмена"));
}

/** Полный блок прогресса в зоне расшифровки во время обработки. */
export function ProcessingProgressPanel({
  document,
  canceling = false,
  onCancel,
}: ProcessingProgressPanelProps) {
  const cancelPending = isCancelMessage(document.errorMessage);
  const target = processingPercent(document);
  const smooth = useSmoothProgress(target, {
    active: !cancelPending,
    max: 99.5,
  });
  const overallPercent = cancelPending ? target : smooth;
  const overallEta = cancelPending ? null : processingEtaSec(document);
  const rows = useMemo(
    () => pageProgressRows(document, document.pageErrors),
    [document],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f7f9fc]">
      <div className="border-b border-sky-100 bg-sky-50/90 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-950">
              <Spinner className="h-3.5 w-3.5 text-sky-700" />
              {cancelPending ? "Останавливаем обработку…" : "Обработка файла"}
              {document.pipelineMode === "mock" ? (
                <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                  mock
                </span>
              ) : null}
            </div>
            <div className="mt-1 truncate text-[11px] text-sky-900/80">
              {document.originalName ?? "Документ"}
              {document.pipelineMode === "mock"
                ? " · внутренний обработчик, модель не вызывается"
                : document.pipelineModel
                  ? ` · модель ${document.pipelineModel}`
                  : document.pipelineMode === "real"
                    ? " · real"
                    : ""}
            </div>
          </div>
          {onCancel && !cancelPending ? (
            <button
              type="button"
              disabled={canceling}
              onClick={onCancel}
              className="shrink-0 rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-50"
            >
              {canceling ? "Отмена…" : "Стоп"}
            </button>
          ) : null}
        </div>

        <div className="mt-3 space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]">
            <span className="font-semibold tabular-nums text-sky-950">
              {formatProcessingPercent(overallPercent)}
            </span>
            <span className="tabular-nums text-sky-900/80">
              прошло {formatProgressDuration(document.pipelineElapsedSec)}
              {" · "}
              осталось {formatProgressDuration(overallEta)}
            </span>
          </div>
          <ProgressTrack value={overallPercent} tone="sky" className="h-2" />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-3">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted">
          По листам
        </div>
        {rows.map((row) => (
          <div
            key={row.pageNumber}
            className={`rounded-md border px-2.5 py-2 ${
              row.status === "active"
                ? "border-sky-200 bg-white"
                : row.status === "error"
                  ? "border-red-200 bg-red-50/70"
                  : "border-border bg-white"
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
              <span
                className={`font-medium ${
                  row.status === "error"
                    ? "text-red-800"
                    : row.status === "active"
                      ? "text-sky-950"
                      : row.status === "done"
                        ? "text-emerald-900"
                        : "text-muted"
                }`}
              >
                Лист {row.pageNumber}
                <span className="ml-1.5 font-normal opacity-80">
                  · {row.label}
                </span>
              </span>
              <span className="font-semibold tabular-nums">
                {formatProcessingPercent(row.percent)}
              </span>
            </div>
            <ProgressTrack
              value={row.percent}
              tone={row.status === "active" ? "sky" : "accent"}
              className="h-1.5"
            />
            <div className="mt-1 flex justify-between gap-2 text-[10px] tabular-nums text-muted">
              <span>прошло {formatProgressDuration(row.elapsedSec)}</span>
              <span>
                {row.status === "done"
                  ? "осталось 0 с"
                  : row.status === "pending"
                    ? `оценка ${formatProgressDuration(row.etaSec)}`
                    : `осталось ${formatProgressDuration(row.etaSec)}`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Итоговая строка после завершения или остановки — без баров по листам. */
export function ProcessingSummaryStrip({
  document,
  errorCount = 0,
}: {
  document: ProgressInput & { errorMessage?: string | null };
  errorCount?: number;
}) {
  const stopped = isCancelMessage(document.errorMessage);
  if (document.status !== "done" && document.status !== "error") return null;

  return (
    <div className="border-b border-border bg-[#fafbfc] px-4 py-1.5 text-[11px] text-muted">
      {stopped ? (
        <span className="text-amber-800">Обработка остановлена</span>
      ) : document.status === "error" ? (
        <span className="text-red-700">
          Ошибка обработки
          {document.errorMessage ? `: ${document.errorMessage}` : ""}
        </span>
      ) : (
        <span>Обработка завершена · 100%</span>
      )}
      <span className="ml-2">
        {document.readyPages}/{Math.max(document.pageCount, 1)} листов
      </span>
      {document.pipelineElapsedSec != null ? (
        <span className="ml-2">
          время {formatProgressDuration(document.pipelineElapsedSec)}
        </span>
      ) : null}
      {errorCount > 0 ? (
        <span className="ml-2 text-red-700">ошибок листов: {errorCount}</span>
      ) : null}
    </div>
  );
}

/** Компактный угол при просмотре уже готового файла — не мешает чтению. */
export function ProcessingCompactBadge({
  document,
}: {
  document: ProgressInput & { errorMessage?: string | null };
}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  if (document.status !== "done" && document.status !== "error") return null;

  const stopped = isCancelMessage(document.errorMessage);

  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-20 w-[min(100%-1.5rem,17.5rem)] rounded-lg border border-border bg-white/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-text">
            {stopped
              ? "Обработка остановлена"
              : document.status === "error"
                ? "Ошибка обработки"
                : "Обработка завершена"}
          </div>
          <div className="mt-1 text-[11px] leading-snug text-muted">
            {document.readyPages}/{Math.max(document.pageCount, 1)} листов
            {document.pipelineElapsedSec != null
              ? ` · ${formatProgressDuration(document.pipelineElapsedSec)}`
              : ""}
            {document.status === "done" ? " · 100%" : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-bg hover:text-text"
          title="Скрыть"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
