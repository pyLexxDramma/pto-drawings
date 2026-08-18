"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageStrip } from "@/components/page-strip";
import { PdfPage } from "@/components/pdf-page";
import { formatDate } from "@/lib/format";
import { KIND_LABEL, type DocumentRecord, type PageKind } from "@/types";

type ReviewPaneProps = {
  document: DocumentRecord;
  focusMode: boolean;
  onToggleFocus: () => void;
  onSavePage: (pageNumber: number, markdown: string) => Promise<void>;
};

function stepLabel(document: DocumentRecord) {
  if (document.status === "queued") return "в очереди";
  if (document.processingStep === "text") return "текст";
  if (document.processingStep === "drawings") return "чертёж";
  return "обработка";
}

export function ReviewPane({
  document,
  focusMode,
  onToggleFocus,
  onSavePage,
}: ReviewPaneProps) {
  const [pageNumber, setPageNumber] = useState(1);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [split, setSplit] = useState(58);
  const [query, setQuery] = useState("");
  const [showLog, setShowLog] = useState(false);
  const draftRef = useRef(draft);
  const pageRef = useRef(pageNumber);
  const timerRef = useRef<number | null>(null);

  const total = Math.max(document.pageCount, document.pages.length, 1);
  const page = document.pages.find((item) => item.pageNumber === pageNumber);
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

  draftRef.current = draft;
  pageRef.current = pageNumber;

  useEffect(() => {
    setPageNumber(1);
    setMode("view");
    setQuery("");
  }, [document.id]);

  useEffect(() => {
    setDraft(
      document.pages.find((item) => item.pageNumber === pageNumber)?.markdown ??
        "",
    );
    setMode("view");
  }, [document.id, pageNumber]);

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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target && ["INPUT", "TEXTAREA"].includes(target.tagName);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush();
        return;
      }

      if (event.key === "Escape" && focusMode) {
        onToggleFocus();
        return;
      }

      if (typing) return;

      if (event.key === "j" || event.key === "J" || event.key === " ") {
        event.preventDefault();
        void goToPage(Math.min(total, pageRef.current + 1));
      }
      if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        void goToPage(Math.max(1, pageRef.current - 1));
      }
      if (event.key === "ArrowLeft") {
        void goToPage(Math.max(1, pageRef.current - 1));
      }
      if (event.key === "ArrowRight") {
        void goToPage(Math.min(total, pageRef.current + 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, onToggleFocus, total, document.pages]);

  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return document.pages.flatMap((item) => {
      const source = `${item.markdown}\n${item.extractedText}`;
      const index = source.toLowerCase().indexOf(needle);
      if (index < 0) return [];
      const snippet = source.slice(Math.max(0, index - 24), index + needle.length + 36).replace(/\s+/g, " ");
      return [{ pageNumber: item.pageNumber, snippet }];
    });
  }, [document.pages, query]);

  const pageLogs = document.editLog.filter((item) => item.pageNumber === pageNumber);

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

  async function goToPage(next: number) {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    await flush();
    setPageNumber(next);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{document.originalName}</div>
          <div className="text-[11px] text-muted">
            {page ? KIND_LABEL[page.kind] : "Страница"} · лист {pageNumber} из {total}
            {editedPages.has(pageNumber) ? " · правили" : ""}
            {saving ? " · сохранение" : ""}
            {" · "}J/K, пробел, ←→, Ctrl+S
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleFocus}
            className="rounded-md border border-border px-2 py-1 text-xs"
          >
            {focusMode ? "К проектам" : "Чертёж на весь экран"}
          </button>
          <button
            type="button"
            onClick={() => void goToPage(Math.max(1, pageNumber - 1))}
            className="rounded-md border border-border px-2 py-1 text-sm disabled:opacity-40"
            disabled={pageNumber <= 1}
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => void goToPage(Math.min(total, pageNumber + 1))}
            className="rounded-md border border-border px-2 py-1 text-sm disabled:opacity-40"
            disabled={pageNumber >= total}
          >
            →
          </button>
        </div>
      </div>

      {processing ? (
        <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-800">
          текст → чертёж
          {document.processingPage
            ? `, ${document.processingPage}/${document.pageCount}`
            : ""}
          {" · "}
          сейчас: {stepLabel(document)}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <PageStrip
          url={`/api/documents/${document.id}/file`}
          total={total}
          current={pageNumber}
          kinds={kinds}
          edited={editedPages}
          onSelect={(next) => void goToPage(next)}
        />

        <div className="flex min-h-0 min-w-0 flex-1">
          <div className="relative min-h-0 min-w-0" style={{ width: `${split}%` }}>
            <PdfPage
              url={`/api/documents/${document.id}/file`}
              pageNumber={pageNumber}
            />
            {processing ? (
              <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-slate-900/75 px-2.5 py-1 text-xs text-white">
                текст → чертёж
                {document.processingPage
                  ? `, ${document.processingPage}/${document.pageCount}`
                  : ""}
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
              <div className="text-xs font-medium text-muted">Markdown</div>
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

            <div className="border-b border-border px-3 py-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по комплекту: PSV, 210 кг, позиция…"
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
              {Array.from({ length: total }, (_, index) => index + 1).map((number) => {
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
                    {editedPages.has(number) ? " · правили" : ""}
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {!page ? (
                <div className="p-6 text-sm text-muted">
                  {processing
                    ? "Текст появится по мере обработки страниц."
                    : "Для этого листа ещё нет текста."}
                </div>
              ) : mode === "edit" ? (
                <textarea
                  value={draft}
                  onChange={(event) => queueSave(event.target.value)}
                  spellCheck={false}
                  className="h-full min-h-[320px] w-full resize-none bg-[#f7f8fa] p-4 font-mono text-[13px] leading-6 text-text outline-none"
                />
              ) : (
                <div className="markdown-body p-5">
                  <Markdown remarkPlugins={[remarkGfm]}>{page.markdown}</Markdown>
                </div>
              )}
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
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
