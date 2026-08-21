"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { MarkdownView } from "@/components/markdown-view";
import { PageStrip } from "@/components/page-strip";
import { PdfPage } from "@/components/pdf-page";
import { ProgressTrack, Spinner } from "@/components/ui-chrome";
import { formatDate } from "@/lib/format";
import { formatElapsed, formatPipelineUsage } from "@/lib/pipeline";
import {
  cacheProgress,
  fetchProgress,
  loadCachedProgress,
  pushProgress,
} from "@/lib/review-state";
import {
  KIND_LABEL,
  SOURCE_LABEL,
  type AnnotationRect,
  type DocumentRecord,
  type PageAnnotation,
  type PageKind,
} from "@/types";

type KindFilter = "all" | "drawing" | "table" | "text" | "flagged";

type ReviewPaneProps = {
  document: DocumentRecord;
  focusMode: boolean;
  openPage?: { nonce: number; page: number; documentId: string } | null;
  canceling?: boolean;
  onCancel?: () => void;
  onToggleFocus: () => void;
  onBackToProjects: () => void;
  onSavePage: (pageNumber: number, markdown: string) => Promise<void>;
  onAnnotationsChanged?: () => void;
};

function stepLabel(document: DocumentRecord) {
  if (document.status === "queued") return "в очереди";
  if (document.processingStep === "text") return "текст и таблицы";
  if (document.processingStep === "drawings") return "чертёж";
  return "обработка";
}

export function ReviewPane({
  document,
  focusMode,
  openPage,
  canceling = false,
  onCancel,
  onToggleFocus,
  onBackToProjects,
  onSavePage,
  onAnnotationsChanged,
}: ReviewPaneProps) {
  const [rawPage, setRawPage] = useState(() => loadCachedProgress(document.id).lastPage);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [split, setSplit] = useState(58);
  const [query, setQuery] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [viewed, setViewed] = useState<number[]>(
    () => loadCachedProgress(document.id).viewed,
  );
  const [notes, setNotes] = useState<PageAnnotation[]>([]);
  const [markMode, setMarkMode] = useState(false);
  const [pendingRect, setPendingRect] = useState<AnnotationRect | null>(null);
  const [noteComment, setNoteComment] = useState("");
  const [noteExpected, setNoteExpected] = useState("");
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [pdfHighlight, setPdfHighlight] = useState(0);
  const draftRef = useRef(draft);
  const pageRef = useRef(rawPage);
  const timerRef = useRef<number | null>(null);
  const navigatedRef = useRef(false);

  const total = Math.max(document.pageCount, document.pages.length, 1);
  const processing =
    document.status === "queued" || document.status === "processing";
  const editedPages = useMemo(
    () => new Set(document.editLog.map((entry) => entry.pageNumber)),
    [document.editLog],
  );
  const kinds = useMemo(() => {
    const map = new Map<number, PageKind>();
    for (const item of document.pages) map.set(item.pageNumber, item.kind);
    return map;
  }, [document.pages]);
  const ready = useMemo(
    () => new Set(document.pages.map((item) => item.pageNumber)),
    [document.pages],
  );
  const viewedSet = useMemo(() => new Set(viewed), [viewed]);
  const flaggedPages = useMemo(
    () => new Set(notes.filter((item) => item.status === "open").map((item) => item.pageNumber)),
    [notes],
  );
  const annotatedPages = useMemo(
    () => new Set(notes.map((item) => item.pageNumber)),
    [notes],
  );
  const matchesFilter = useMemo(() => {
    return (number: number) => {
      if (filter === "all") return true;
      if (filter === "flagged") return flaggedPages.has(number);
      const kind = kinds.get(number);
      if (!kind) return false;
      if (filter === "drawing") return kind === "drawing" || kind === "mixed";
      return kind === filter;
    };
  }, [filter, flaggedPages, kinds]);

  const filterCounts = useMemo(() => {
    const counts: Record<KindFilter, number> = {
      all: total,
      drawing: 0,
      table: 0,
      text: 0,
      flagged: flaggedPages.size,
    };
    for (let number = 1; number <= total; number += 1) {
      const kind = kinds.get(number);
      if (kind === "drawing" || kind === "mixed") counts.drawing += 1;
      if (kind === "table") counts.table += 1;
      if (kind === "text") counts.text += 1;
    }
    return counts;
  }, [flaggedPages.size, kinds, total]);

  const visiblePages = useMemo(
    () =>
      Array.from({ length: total }, (_, index) => index + 1).filter((number) =>
        matchesFilter(number),
      ),
    [matchesFilter, total],
  );
  const filterEmpty = filter !== "all" && visiblePages.length === 0;
  const hidden = useMemo(() => {
    const visible = new Set(visiblePages);
    const set = new Set<number>();
    for (let number = 1; number <= total; number += 1) {
      if (!visible.has(number)) set.add(number);
    }
    return set;
  }, [total, visiblePages]);

  // Номер листа выводим из состояния: так он сам держится в границах комплекта
  // и текущего фильтра, без эффектов-подгонок.
  const clampedPage = Math.min(Math.max(rawPage, 1), Math.max(total, 1));
  const pageNumber =
    visiblePages.length === 0 || visiblePages.includes(clampedPage)
      ? clampedPage
      : visiblePages[0];
  const page = document.pages.find((item) => item.pageNumber === pageNumber);
  const pageNotes = notes.filter((item) => item.pageNumber === pageNumber);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    pageRef.current = pageNumber;
  }, [pageNumber]);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      const server = await fetchProgress(document.id, ac.signal);
      if (!server || ac.signal.aborted) return;
      setViewed(server.viewed);
      // Если инженер уже листает, не выдёргиваем его на сохранённый лист.
      if (!navigatedRef.current) setRawPage(server.lastPage);
    })();
    return () => ac.abort();
  }, [document.id]);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/documents/${document.id}/annotations`, {
          signal: ac.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { annotations?: PageAnnotation[] };
        setNotes(payload.annotations ?? []);
      } catch {
        // прервано при смене документа
      }
    })();
    return () => ac.abort();
  }, [document.id]);

  useEffect(() => {
    if (!openPage || openPage.documentId !== document.id) return;
    navigatedRef.current = true;
    // Переход из фида проекта: внешнее событие, поэтому состояние двигаем здесь.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRawPage(openPage.page);
    setMode("view");
  }, [document.id, openPage]);

  useEffect(() => {
    cacheProgress(document.id, { viewed, lastPage: pageNumber });
    const timer = window.setTimeout(() => {
      void pushProgress(document.id, { viewed, lastPage: pageNumber });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [document.id, pageNumber, viewed]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setViewed((prev) => (prev.includes(pageNumber) ? prev : [...prev, pageNumber]));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [document.id, pageNumber]);

  useEffect(() => {
    // Таблицы читаются шире, чем чертёж: отдаём им больше правой панели.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (page?.kind === "table") setSplit(42);
  }, [page?.kind]);

  async function flush(pageToSave = pageRef.current, text = draftRef.current) {
    const current = document.pages.find((item) => item.pageNumber === pageToSave);
    if (!current || current.markdown === text) return;
    setSaving(true);
    try {
      await onSavePage(pageToSave, text);
    } finally {
      setSaving(false);
    }
  }

  function queueSave(next: string) {
    setDraft(next);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void flush(pageNumber, next);
    }, 700);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function goToPage(next: number) {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    navigatedRef.current = true;
    await flush();
    setMode("view");
    setRawPage(next);
  }

  function stepVisible(delta: number) {
    const index = visiblePages.indexOf(pageRef.current);
    const fallback = delta > 0 ? visiblePages[0] : visiblePages[visiblePages.length - 1];
    const target = visiblePages[index + delta] ?? fallback;
    if (target) void goToPage(target);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA"].includes(target.tagName);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush();
        return;
      }

      if (event.key === "Escape") {
        if (showHelp) {
          setShowHelp(false);
          return;
        }
        if (markMode || pendingRect) {
          setMarkMode(false);
          setPendingRect(null);
          return;
        }
        if (focusMode) onToggleFocus();
        else onBackToProjects();
        return;
      }

      if (typing) return;

      if (event.key === "?" || (event.shiftKey && event.key === "/")) {
        event.preventDefault();
        setShowHelp((value) => !value);
        return;
      }

      if (event.key === "j" || event.key === "J" || event.key === " ") {
        event.preventDefault();
        stepVisible(1);
      }
      if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        stepVisible(-1);
      }
      if (event.key === "ArrowLeft") stepVisible(-1);
      if (event.key === "ArrowRight") stepVisible(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMode, markMode, pendingRect, onBackToProjects, onToggleFocus, visiblePages, document.pages, showHelp]);

  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return document.pages.flatMap((item) => {
      const source = `${item.markdown}\n${item.extractedText}`;
      const index = source.toLowerCase().indexOf(needle);
      if (index < 0) return [];
      const snippet = source
        .slice(Math.max(0, index - 24), index + needle.length + 36)
        .replace(/\s+/g, " ");
      return [{ pageNumber: item.pageNumber, snippet }];
    });
  }, [document.pages, query]);

  const pageLogs = document.editLog.filter((item) => item.pageNumber === pageNumber);
  const readyCount = document.pages.length;
  const progress = Math.round((readyCount / Math.max(total, 1)) * 100);

  function startSplit(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const parent = event.currentTarget.parentElement;
    if (!parent) return;
    const move = (moveEvent: globalThis.MouseEvent) => {
      const rect = parent.getBoundingClientRect();
      const next = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setSplit(Math.min(78, Math.max(32, next)));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function toggleViewed() {
    setViewed((prev) =>
      prev.includes(pageNumber)
        ? prev.filter((item) => item !== pageNumber)
        : [...prev, pageNumber],
    );
  }

  async function submitNote() {
    if (!pendingRect) return;
    const comment = noteComment.trim();
    if (!comment) {
      setNoteError("Опишите, что неверно");
      return;
    }
    setNoteError(null);
    const response = await fetch(`/api/documents/${document.id}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageNumber,
        rect: pendingRect,
        comment,
        expected: noteExpected.trim(),
      }),
    });
    const payload = (await response.json()) as {
      annotation?: PageAnnotation;
      error?: string;
    };
    if (!payload.annotation) {
      setNoteError(payload.error ?? "Не удалось сохранить замечание");
      return;
    }
    setNotes((prev) => [payload.annotation!, ...prev]);
    setPendingRect(null);
    setMarkMode(false);
    setNoteComment("");
    setNoteExpected("");
    onAnnotationsChanged?.();
  }

  async function toggleNoteStatus(note: PageAnnotation) {
    const next = note.status === "open" ? "fixed" : "open";
    const response = await fetch(
      `/api/documents/${document.id}/annotations/${note.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      },
    );
    const payload = (await response.json()) as {
      annotation?: PageAnnotation;
      error?: string;
    };
    if (!payload.annotation) {
      setNoteError(payload.error ?? "Не удалось обновить замечание");
      return;
    }
    setNotes((prev) =>
      prev.map((item) => (item.id === note.id ? payload.annotation! : item)),
    );
    onAnnotationsChanged?.();
  }

  async function removeNote(note: PageAnnotation) {
    const response = await fetch(
      `/api/documents/${document.id}/annotations/${note.id}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setNoteError(payload.error ?? "Не удалось удалить замечание");
      return;
    }
    setNotes((prev) => prev.filter((item) => item.id !== note.id));
    onAnnotationsChanged?.();
  }

  const filters: { id: KindFilter; label: string }[] = [
    { id: "all", label: "Все" },
    { id: "drawing", label: "Чертежи" },
    { id: "table", label: "Таблицы" },
    { id: "text", label: "Текст" },
    { id: "flagged", label: "С замечаниями" },
  ];
  const filterLabel =
    filters.find((item) => item.id === filter)?.label.toLowerCase() ?? "этот тип";
  const openNotes = notes.filter((item) => item.status === "open").length;
  const usageLabel = formatPipelineUsage(document.pipelineUsage);
  const elapsedLabel = formatElapsed(document.pipelineElapsedSec);
  const pageError = document.pageErrors?.[String(pageNumber)] ?? null;
  const isMockPage = Boolean(page?.markdown.includes("[MOCK]"));
  const showMock =
    document.pipelineMode === "mock" ||
    isMockPage ||
    document.pages.some((item) => item.markdown.includes("[MOCK]"));
  const errorCount = Object.keys(document.pageErrors ?? {}).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {document.originalName}
            {showMock ? (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                mock
              </span>
            ) : null}
            {document.pipelineMode === "real" ? (
              <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800">
                real
              </span>
            ) : null}
          </div>
          <div className="text-[11px] text-muted">
            {page ? KIND_LABEL[page.kind] : "Страница"} · лист {pageNumber} из {total}
            {viewedSet.has(pageNumber) ? " · просмотрен" : ""}
            {editedPages.has(pageNumber) ? " · правки" : ""}
            {saving ? " · сохранение" : ""}
            {" · "}
            {viewed.length}/{total} просмотрено
            {openNotes ? ` · ${openNotes} замечаний` : ""}
            {elapsedLabel ? ` · ${elapsedLabel}` : ""}
            {usageLabel ? ` · ${usageLabel}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBackToProjects}
            className="rounded-md border border-border px-2 py-1 text-xs"
          >
            К проектам
          </button>
          <a
            href={`/api/documents/${document.id}/markdown`}
            download
            className="rounded-md border border-border px-2 py-1 text-xs"
          >
            Скачать .md
          </a>
          <button
            type="button"
            onClick={() => {
              setPendingRect(null);
              setMarkMode((value) => !value);
            }}
            className={`rounded-md border px-2 py-1 text-xs ${
              markMode
                ? "border-red-500 bg-red-50 text-red-700"
                : "border-border"
            }`}
          >
            {markMode ? "Отмена" : "Отметить ошибку"}
          </button>
          <button
            type="button"
            onClick={toggleViewed}
            className="rounded-md border border-border px-2 py-1 text-xs"
          >
            {viewedSet.has(pageNumber) ? "Снять просмотр" : "Просмотрено"}
          </button>
          <button
            type="button"
            onClick={onToggleFocus}
            className="rounded-md border border-border px-2 py-1 text-xs"
          >
            {focusMode ? "Обычный вид" : "Чертёж на весь экран"}
          </button>
          <button
            type="button"
            title="Горячие клавиши (?)"
            onClick={() => setShowHelp(true)}
            className="rounded-md border border-border px-2 py-1 text-xs"
          >
            ?
          </button>
          <button
            type="button"
            onClick={() => stepVisible(-1)}
            className="rounded-md border border-border px-2 py-1 text-sm disabled:opacity-40"
            disabled={visiblePages[0] === pageNumber}
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => stepVisible(1)}
            className="rounded-md border border-border px-2 py-1 text-sm disabled:opacity-40"
            disabled={visiblePages[visiblePages.length - 1] === pageNumber}
          >
            →
          </button>
        </div>
      </div>

      {processing ? (
        <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Spinner className="h-3.5 w-3.5 text-sky-700" />
              <div>
              готово {readyCount}/{total} листов
              {document.processingPage
                ? ` · сейчас лист ${document.processingPage}: ${stepLabel(document)}`
                : ` · ${stepLabel(document)}`}
              {elapsedLabel ? ` · ${elapsedLabel}` : ""}
              {usageLabel ? ` · ${usageLabel}` : ""}
              {errorCount ? ` · ошибок листов: ${errorCount}` : ""}
              </div>
            </div>
            {onCancel ? (
              <button
                type="button"
                disabled={canceling}
                onClick={onCancel}
                className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs text-sky-900 hover:bg-sky-100 disabled:opacity-50"
              >
                {canceling ? "Отмена…" : "Отменить обработку"}
              </button>
            ) : null}
          </div>
          <div className="mt-1.5">
            <ProgressTrack value={progress} tone="sky" className="h-1.5" />
          </div>
        </div>
      ) : null}

      {!processing && (elapsedLabel || usageLabel || errorCount || showMock) ? (
        <div className="border-b border-border bg-bg px-4 py-1.5 text-[11px] text-muted">
          {showMock ? <span className="mr-2 text-amber-800">[MOCK]</span> : null}
          {document.pipelineMode === "real" ? (
            <span className="mr-2 text-red-800">режим real</span>
          ) : null}
          {elapsedLabel ? <span className="mr-2">время: {elapsedLabel}</span> : null}
          {usageLabel ? <span className="mr-2">токены: {usageLabel}</span> : null}
          {errorCount ? (
            <span className="text-red-700">листов с ошибкой: {errorCount}</span>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <PageStrip
          url={`/api/documents/${document.id}/file`}
          total={total}
          current={pageNumber}
          kinds={kinds}
          edited={editedPages}
          viewed={viewedSet}
          ready={ready}
          annotated={annotatedPages}
          hidden={hidden}
          processingPage={document.processingPage}
          onSelect={(next) => void goToPage(next)}
        />

        <div className="flex min-h-0 min-w-0 flex-1">
          <div className="relative min-h-0 min-w-0" style={{ width: `${split}%` }}>
            <PdfPage
              url={`/api/documents/${document.id}/file`}
              pageNumber={pageNumber}
              annotations={pageNotes}
              markMode={markMode}
              activeAnnotationId={activeNoteId}
              highlightNonce={pdfHighlight}
              onMarkRect={(rect) => setPendingRect(rect)}
              onSelectAnnotation={(id) => setActiveNoteId(id)}
              onCancelMark={() => {
                setMarkMode(false);
                setPendingRect(null);
              }}
            />
            {processing ? (
              <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-slate-900/75 px-2.5 py-1 text-xs text-white">
                {readyCount}/{total}
                {document.processingPage ? ` · лист ${document.processingPage}` : ""}
              </div>
            ) : null}
          </div>

          <div
            role="separator"
            onMouseDown={startSplit}
            className="w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-accent"
          />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="text-xs font-medium text-muted">
                {page?.kind === "table" ? "Таблица как в PDF" : "Markdown"}
                {page ? ` · ${SOURCE_LABEL[page.source]}` : ""}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (mode === "view") {
                      setDraft(page?.markdown ?? "");
                      setMode("edit");
                    } else {
                      setMode("view");
                    }
                  }}
                  className="rounded-md border border-border px-2.5 py-1 text-xs"
                >
                  {mode === "view" ? "Исправить" : "Просмотр"}
                </button>
              </div>
            </div>

            {page && page.warnings.length > 0 ? (
              <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                {page.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            ) : null}

            {pendingRect ? (
              <div className="border-b border-red-200 bg-red-50 px-3 py-2">
                <div className="text-[11px] font-medium text-red-700">
                  Новое замечание на листе {pageNumber}
                </div>
                <textarea
                  autoFocus
                  value={noteComment}
                  onChange={(event) => setNoteComment(event.target.value)}
                  rows={2}
                  placeholder="Что неверно"
                  className="mt-1 w-full resize-none rounded-md border border-border bg-white px-2 py-1.5 text-xs outline-none focus:border-accent"
                />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {[
                    "Нет размера",
                    "Неверная спецификация",
                    "Ошибка в штампе",
                    "Нет позиции",
                    "Неверный масштаб",
                    "Расхождение с ТЗ",
                  ].map((label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() =>
                        setNoteComment((prev) =>
                          prev.trim() ? `${prev.trim()}. ${label}` : label,
                        )
                      }
                      className="rounded-full border border-red-200 bg-white px-2 py-0.5 text-[10px] text-red-800 hover:bg-red-100"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={noteExpected}
                  onChange={(event) => setNoteExpected(event.target.value)}
                  rows={2}
                  placeholder="Как должно быть (необязательно)"
                  className="mt-1 w-full resize-none rounded-md border border-border bg-white px-2 py-1.5 text-xs outline-none focus:border-accent"
                />
                {noteError ? (
                  <div className="mt-1 text-[11px] text-red-700">{noteError}</div>
                ) : null}
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void submitNote()}
                    className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white"
                  >
                    Сохранить
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingRect(null);
                      setNoteComment("");
                      setNoteExpected("");
                      setNoteError(null);
                    }}
                    className="rounded-md border border-border px-2.5 py-1 text-xs"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    filter === item.id
                      ? "bg-blue-50 text-text"
                      : "text-muted hover:bg-bg"
                  }`}
                >
                  {item.label}
                  <span className="ml-1 tabular-nums text-muted">
                    {filterCounts[item.id]}
                  </span>
                </button>
              ))}
            </div>

            <div className="border-b border-border px-3 py-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по этому файлу: PSV, 210 кг, позиция…"
                className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
              {hits.length > 0 ? (
                <div className="mt-2 max-h-28 space-y-1 overflow-auto">
                  {hits.map((hit) => (
                    <button
                      key={`${hit.pageNumber}-${hit.snippet}`}
                      type="button"
                      onClick={() => void goToPage(hit.pageNumber)}
                      className="block w-full rounded bg-bg px-2 py-1 text-left text-[11px] hover:bg-blue-50"
                    >
                      <span className="font-medium">Лист {hit.pageNumber}</span>
                      <span className="text-muted"> · {hit.snippet}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex max-h-28 shrink-0 flex-col overflow-auto border-b border-border px-2 py-2">
              {filterEmpty ? (
                <div className="px-2 py-2 text-xs text-muted">
                  {filter === "flagged"
                    ? "Замечаний по этому файлу пока нет."
                    : `В комплекте нет листов типа «${filterLabel}» (0 из ${total}). Классификация по извлечённому тексту листа.`}
                </div>
              ) : null}
              {visiblePages.map((number) => {
                const item = document.pages.find((pageItem) => pageItem.pageNumber === number);
                const kind = item ? KIND_LABEL[item.kind] : "лист";
                return (
                  <button
                    key={number}
                    type="button"
                    onClick={() => void goToPage(number)}
                    className={`rounded px-2 py-1 text-left text-xs ${
                      number === pageNumber ? "bg-blue-50 text-text" : "text-muted hover:bg-bg"
                    }`}
                  >
                    # Лист {number} — {kind.toLowerCase()}
                    {viewedSet.has(number) ? " · просмотрен" : ""}
                    {editedPages.has(number) ? " · правки" : ""}
                    {flaggedPages.has(number) ? " · замечание" : ""}
                    {!item ? " · ждёт текст" : ""}
                    {document.pageErrors?.[String(number)] ? " · ошибка" : ""}
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {filterEmpty ? (
                <div className="p-6 text-sm text-muted">
                  {filter === "flagged"
                    ? "Отметьте ошибку на чертеже — лист появится в этом списке."
                    : `Нет листов типа «${filterLabel}» в этом комплекте. Выберите «Все» или вкладку с ненулевым счётчиком.`}
                </div>
              ) : !page ? (
                <div className="p-6 text-sm text-muted">
                  {processing
                    ? `Текст появится по мере обработки. Готово ${readyCount} из ${total}.`
                    : pageError
                      ? `Лист не обработан: ${pageError}`
                      : "Для этого листа ещё нет текста."}
                </div>
              ) : mode === "edit" ? (
                <textarea
                  value={draft}
                  onChange={(event) => queueSave(event.target.value)}
                  spellCheck={false}
                  className={`h-full min-h-[320px] w-full resize-none bg-[#f7f8fa] p-4 font-mono text-[13px] leading-6 text-text outline-none ${
                    page.kind === "table" ? "overflow-auto whitespace-pre" : ""
                  }`}
                />
              ) : (
                <div
                  className={`markdown-body p-5 ${page.kind === "table" ? "markdown-body--table" : ""}`}
                >
                  {pageError ? (
                    <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      Ошибка листа: {pageError}
                    </div>
                  ) : null}
                  {isMockPage ? (
                    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                      Это ответ режима [MOCK], не работа модели.
                    </div>
                  ) : null}
                  <MarkdownView
                    onAnchor={({ pageHint }) => {
                      if (pageHint && pageHint !== pageNumber) {
                        void goToPage(pageHint);
                      }
                      setPdfHighlight((value) => value + 1);
                    }}
                  >
                    {page.markdown}
                  </MarkdownView>
                </div>
              )}
            </div>

            <div className="border-t border-border px-3 py-2">
              <div className="text-xs font-medium text-muted">
                Замечания по листу: {pageNotes.length}
              </div>
              <div className="mt-1 max-h-40 space-y-1.5 overflow-auto">
                {pageNotes.length === 0 ? (
                  <div className="text-[11px] text-muted">
                    Нажмите «Отметить ошибку» и обведите место на чертеже.
                  </div>
                ) : (
                  pageNotes.map((note, index) => (
                    <div
                      key={note.id}
                      onMouseEnter={() => setActiveNoteId(note.id)}
                      onMouseLeave={() => setActiveNoteId(null)}
                      className={`rounded-md border px-2 py-1.5 text-[11px] ${
                        note.status === "open"
                          ? "border-red-200 bg-red-50"
                          : "border-emerald-200 bg-emerald-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {index + 1}. {note.status === "open" ? "открыто" : "исправлено"}
                        </span>
                        <span className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void toggleNoteStatus(note)}
                            className="text-accent hover:underline"
                          >
                            {note.status === "open" ? "Исправлено" : "Вернуть"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeNote(note)}
                            className="text-red-600 hover:underline"
                          >
                            Удалить
                          </button>
                        </span>
                      </div>
                      <div className="mt-0.5">{note.comment}</div>
                      {note.expected ? (
                        <div className="mt-0.5 text-muted">Должно быть: {note.expected}</div>
                      ) : null}
                      <div className="mt-0.5 text-muted">
                        {note.userName ? `${note.userName} · ` : ""}
                        {formatDate(note.createdAt)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="border-t border-border px-3 py-2">
              <button
                type="button"
                onClick={() => setShowLog((value) => !value)}
                className="text-xs text-muted hover:text-text"
              >
                Правки инженера: {pageLogs.length}
                {editedPages.has(pageNumber) ? " · этот лист меняли" : ""}
              </button>
              {showLog ? (
                <div className="mt-2 max-h-36 space-y-2 overflow-auto">
                  {pageLogs.length === 0 ? (
                    <div className="text-xs text-muted">По этому листу правок ещё нет.</div>
                  ) : (
                    pageLogs.map((entry) => (
                      <div key={entry.id} className="rounded-md bg-surface-2 px-2 py-1.5 text-[11px] text-muted">
                        {formatDate(entry.createdAt)} · лист {entry.pageNumber}
                        {entry.userName ? ` · ${entry.userName}` : ""}
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {showHelp ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Горячие клавиши"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium">Горячие клавиши</div>
              <button
                type="button"
                className="text-xs text-muted hover:text-text"
                onClick={() => setShowHelp(false)}
              >
                Закрыть
              </button>
            </div>
            <ul className="space-y-1.5 text-xs text-muted">
              <li>
                <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-text">
                  J
                </kbd>{" "}
                /{" "}
                <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-text">
                  →
                </kbd>{" "}
                / пробел — следующий лист
              </li>
              <li>
                <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-text">
                  K
                </kbd>{" "}
                /{" "}
                <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-text">
                  ←
                </kbd>{" "}
                — предыдущий лист
              </li>
              <li>
                <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-text">
                  Ctrl+S
                </kbd>{" "}
                — сохранить правки текста
              </li>
              <li>
                <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-text">
                  Esc
                </kbd>{" "}
                — отмена отметки / выход из фокуса / к проектам
              </li>
              <li>
                <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-text">
                  ?
                </kbd>{" "}
                — эта справка
              </li>
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
