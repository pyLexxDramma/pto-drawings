"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  /** Тех. метрики (mock, модель) — только для админа. */
  showTech?: boolean;
  onCancel?: () => void;
  onCollapse?: () => void;
};

function isCancelMessage(message: string | null | undefined) {
  return Boolean(message && message.startsWith("Отмена"));
}

export function processingStatusLabel(
  document: ProgressInput & { errorMessage?: string | null },
): string {
  if (isCancelMessage(document.errorMessage)) return "Пауза";
  if (document.status === "done") return "Завершено";
  if (document.status === "error") return "Ошибка";
  if (document.status === "queued" || document.status === "processing") {
    return "Идёт обработка";
  }
  return "Завершено";
}

/** Полный блок прогресса в зоне расшифровки во время обработки. */
export function ProcessingProgressPanel({
  document,
  canceling = false,
  showTech = false,
  onCancel,
  onCollapse,
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
  const statusLabel = processingStatusLabel(document);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f7f9fc]">
      <div className="border-b border-sky-100 bg-sky-50/90 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-950">
              {cancelPending ? null : (
                <Spinner className="h-3.5 w-3.5 text-sky-700" />
              )}
              {statusLabel}
              {showTech && document.pipelineMode === "mock" ? (
                <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                  mock
                </span>
              ) : null}
            </div>
            <div className="mt-1 truncate text-[11px] text-sky-900/80">
              {document.originalName ?? "Документ"}
              {showTech
                ? document.pipelineMode === "mock"
                  ? " · внутренний обработчик, модель не вызывается"
                  : document.pipelineModel
                    ? ` · модель ${document.pipelineModel}`
                    : document.pipelineMode === "real"
                      ? " · real"
                      : ""
                : ""}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {onCollapse ? (
              <button
                type="button"
                onClick={onCollapse}
                className="rounded-md border border-sky-200 bg-white px-2.5 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100"
                title="Свернуть в угол"
              >
                Свернуть
              </button>
            ) : null}
            {onCancel && !cancelPending ? (
              <button
                type="button"
                disabled={canceling}
                onClick={onCancel}
                className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-50"
              >
                {canceling ? "Отмена…" : "Стоп"}
              </button>
            ) : null}
          </div>
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

type CompactBadgeProps = {
  document: ProgressInput & { errorMessage?: string | null };
  /** Живой прогресс во время обработки (просмотр готовых листов). */
  live?: boolean;
  onExpand?: () => void;
  onGoToCurrent?: () => void;
  currentPage?: number | null;
  className?: string;
};

type BottomBarProps = {
  document: ProgressInput & { errorMessage?: string | null };
  errorCount?: number;
  onExpand?: () => void;
  onGoToCurrent?: () => void;
  currentPage?: number | null;
  onDismiss?: () => void;
};

function processingBottomLine(
  document: ProgressInput & { errorMessage?: string | null },
  percent: number,
  errorCount = 0,
): string {
  const stopped = isCancelMessage(document.errorMessage);
  const pages = `${document.readyPages}/${Math.max(document.pageCount, 1)}`;
  const eta = !stopped ? processingEtaSec(document) : null;
  const etaLabel =
    eta != null && eta > 0 ? `~${formatProgressDuration(eta)}` : null;
  const elapsed =
    document.pipelineElapsedSec != null
      ? formatProgressDuration(document.pipelineElapsedSec)
      : null;

  if (stopped) {
    return ["Остановлено", pages, elapsed].filter(Boolean).join(" · ");
  }
  if (document.status === "error") {
    return ["Ошибка", pages, elapsed].filter(Boolean).join(" · ");
  }
  if (document.status === "done") {
    return [
      `Готово · ${formatProcessingPercent(100)}`,
      pages,
      elapsed,
      errorCount > 0 ? `ошибок: ${errorCount}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return [
    formatProcessingPercent(percent),
    pages,
    etaLabel,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Полоска прогресса внизу справа — одна на весь экран. */
export function LiveProgressDock({
  document,
  errorCount = 0,
  onOpen,
  onCancel,
  canceling = false,
  onDismiss,
  onHide,
  collapsed = false,
  onExpand,
}: {
  document: DocProgress;
  errorCount?: number;
  onOpen?: () => void;
  onCancel?: () => void;
  canceling?: boolean;
  /** После авто-скрытия завершённого job. */
  onDismiss?: () => void;
  /** Скрыть плашку вручную — обработка не останавливается. */
  onHide?: () => void;
  collapsed?: boolean;
  onExpand?: () => void;
}) {
  const cancelPending = isCancelMessage(document.errorMessage);
  const isActive =
    document.status === "queued" ||
    document.status === "processing" ||
    cancelPending;
  const isFinished = document.status === "done" || document.status === "error";
  const [visible, setVisible] = useState(isActive || isFinished);
  const wasActiveRef = useRef(isActive);

  useEffect(() => {
    if (isActive) {
      wasActiveRef.current = true;
      setVisible(true);
      return;
    }
    if (isFinished && wasActiveRef.current) {
      setVisible(true);
      const timer = window.setTimeout(() => {
        setVisible(false);
        onDismiss?.();
      }, 2200);
      return () => window.clearTimeout(timer);
    }
    if (!isFinished) wasActiveRef.current = false;
  }, [isActive, isFinished, document.status, onDismiss]);

  const target = processingPercent(document);
  const smooth = useSmoothProgress(target, {
    active: isActive && !cancelPending,
    max: 99.5,
  });
  const percent = cancelPending
    ? target
    : isFinished && document.status === "done"
      ? 100
      : isActive
        ? smooth
        : target;
  const summaryLine = processingBottomLine(document, percent, errorCount);

  if (!visible) return null;

  // Свёрнутая точка: обработка идёт, плашка скрыта вручную.
  if (collapsed && isActive) {
    return (
      <button
        type="button"
        onClick={onExpand}
        className="pointer-events-auto fixed bottom-3 right-3 z-40 flex max-w-[11rem] items-center gap-1.5 rounded-full border border-sky-200 bg-white/95 px-2.5 py-1.5 text-[10px] font-semibold tabular-nums text-sky-950 shadow-lg backdrop-blur hover:bg-sky-50"
        title="Показать прогресс (обработка продолжается)"
        data-testid="live-progress-dock-collapsed"
      >
        {!cancelPending ? (
          <Spinner className="h-2.5 w-2.5 shrink-0 text-sky-700" />
        ) : null}
        <span className="truncate">{formatProcessingPercent(percent)}</span>
        <span className="text-sky-700/70">▸</span>
      </button>
    );
  }

  if (collapsed) return null;

  return (
    <div
      className="pointer-events-auto fixed bottom-3 right-3 z-40 w-[min(calc(100vw-1.5rem),17rem)] overflow-hidden rounded-lg border border-sky-200/90 bg-white/95 shadow-lg backdrop-blur"
      role="status"
      aria-live="polite"
      data-testid="live-progress-dock"
    >
      <div className="flex items-start gap-1 px-2.5 pt-2">
        <button
          type="button"
          onClick={onOpen}
          disabled={!onOpen}
          className={`min-w-0 flex-1 text-left ${
            onOpen ? "cursor-pointer hover:opacity-90" : "cursor-default"
          }`}
          title={onOpen ? "Открыть обрабатываемый файл" : undefined}
        >
          <div className="flex items-start gap-2">
            {isActive && !cancelPending ? (
              <Spinner className="mt-0.5 h-3 w-3 shrink-0 text-sky-700" />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-semibold text-sky-950">
                {document.originalName ?? "Обработка"}
              </div>
              <div className="mt-0.5 truncate text-[10px] tabular-nums text-sky-900/80">
                {summaryLine}
              </div>
            </div>
          </div>
        </button>
        {onHide && isActive ? (
          <button
            type="button"
            onClick={onHide}
            className="shrink-0 rounded px-1 py-0.5 text-[11px] leading-none text-sky-800/70 hover:bg-sky-50 hover:text-sky-950"
            title="Скрыть (обработка не остановится)"
            aria-label="Скрыть прогресс"
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="px-2.5 pb-1.5 pt-1">
        <ProgressTrack value={percent} tone="sky" className="h-0.5" />
      </div>
      {isActive && onCancel && !cancelPending ? (
        <div className="flex items-center justify-between gap-2 border-t border-sky-100 px-2 py-1">
          <span className="text-[9px] text-sky-800/60">Стоп — остановить</span>
          <button
            type="button"
            disabled={canceling}
            onClick={onCancel}
            className="rounded border border-sky-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-sky-900 hover:bg-sky-50 disabled:opacity-50"
            title="Остановить обработку"
          >
            {canceling ? "…" : "Стоп"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated Используйте LiveProgressDock. */
export function ProcessingBottomBar({
  document,
  errorCount = 0,
  onExpand,
  onGoToCurrent,
  currentPage = null,
  onDismiss,
}: BottomBarProps) {
  return (
    <LiveProgressDock
      document={document}
      errorCount={errorCount}
      onOpen={onExpand ?? onGoToCurrent}
      onDismiss={onDismiss}
    />
  );
}

/** @deprecated Используйте ProcessingBottomBar. */
export function ProcessingCompactBadge({
  document,
  live = false,
  onExpand,
  onGoToCurrent,
  currentPage = null,
  className = "",
}: CompactBadgeProps) {
  const [hidden, setHidden] = useState(false);
  const cancelPending = isCancelMessage(document.errorMessage);
  const target = processingPercent(document);
  const smooth = useSmoothProgress(target, {
    active: live && !cancelPending,
    max: 99.5,
  });
  const percent = live
    ? cancelPending
      ? target
      : document.status === "done"
        ? 100
        : smooth
    : document.status === "done"
      ? 100
      : target;
  const statusLabel = processingStatusLabel(document);

  if (hidden) return null;
  if (!live && document.status !== "done" && document.status !== "error") {
    return null;
  }
  if (
    live &&
    document.status !== "queued" &&
    document.status !== "processing" &&
    !cancelPending
  ) {
    return null;
  }

  const interactive = Boolean(onExpand);

  return (
    <div
      className={`pointer-events-auto z-20 w-[min(100%-1.5rem,16.5rem)] rounded-lg border border-sky-200 bg-white/95 p-2.5 shadow-lg backdrop-blur ${className}`}
    >
      <button
        type="button"
        disabled={!interactive}
        onClick={onExpand}
        className={`w-full text-left ${interactive ? "cursor-pointer" : "cursor-default"}`}
        title={interactive ? "Развернуть прогресс" : undefined}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-950">
              {live && !cancelPending && document.status !== "done" ? (
                <Spinner className="h-3 w-3 text-sky-700" />
              ) : null}
              <span>{statusLabel}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-2 text-[11px] text-muted">
              <span className="font-semibold tabular-nums text-sky-950">
                {formatProcessingPercent(percent)}
              </span>
              <span>
                {document.readyPages}/{Math.max(document.pageCount, 1)} листов
              </span>
            </div>
          </div>
          {!live ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                setHidden(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  setHidden(true);
                }
              }}
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-bg hover:text-text"
              title="Скрыть"
            >
              ✕
            </span>
          ) : interactive ? (
            <span className="shrink-0 text-[10px] font-medium text-sky-800">
              Развернуть
            </span>
          ) : null}
        </div>
        <ProgressTrack value={percent} tone="sky" className="mt-2 h-1.5" />
      </button>
      {live && onGoToCurrent && currentPage != null ? (
        <button
          type="button"
          onClick={onGoToCurrent}
          className="mt-2 w-full rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-950 hover:bg-sky-100"
        >
          К текущему листу {currentPage}
        </button>
      ) : null}
    </div>
  );
}
