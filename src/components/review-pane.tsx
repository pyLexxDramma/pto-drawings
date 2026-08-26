"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ColumnResizer, clamp } from "@/components/column-resizer";
import { CadPage } from "@/components/cad-page";
import { MarkdownView } from "@/components/markdown-view";
import { PageStrip } from "@/components/page-strip";
import { PdfPage } from "@/components/pdf-page";
import { SegmentedTabs, ActionMenu, menuItemClass } from "@/components/ui-chrome";
import { VoiceNoteButton } from "@/components/voice-note";
import { SheetsGallery } from "@/components/sheets-gallery";
import {
  IconCheck,
  IconDoc,
  IconDownload,
  IconExpand,
  IconGrid,
  IconMark,
  IconPencil,
  IconSearch,
  IconSplit,
  IconSync,
  IconThumbs,
} from "@/components/tool-icons";
import { formatDate } from "@/lib/format";
import {
  linkBlocksToRegions,
  nearestBlockForAnchorY,
  parseMarkdownBlocks,
  type PageTextRegion,
} from "@/lib/content-sync";
import { getDrawingExt, isCadExt } from "@/lib/drawing-files";
import { formatElapsed, formatPipelineUsage } from "@/lib/pipeline";
import {
  ProcessingCompactBadge,
  ProcessingProgressPanel,
  ProcessingSummaryStrip,
} from "@/components/processing-progress-panel";
import { ReviewPaneHelp } from "@/components/review-pane-help";
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
type PaneSolo = null | "pdf" | "md";

type ReviewPaneProps = {
  document: DocumentRecord;
  focusMode: boolean;
  openPage?: { nonce: number; page: number; documentId: string } | null;
  canceling?: boolean;
  readOnly?: boolean;
  /** Технические метрики прогона (токены, режим) — только для админа. */
  showTech?: boolean;
  specHref?: string | null;
  specName?: string | null;
  /** Правый край шапки: меню пользователя и статус конвейера из workspace. */
  headerRight?: ReactNode;
  /** Переход к активной обработке в другом файле проекта (если есть). */
  onGoToLiveJob?: (() => void) | null;
  liveJobLabel?: string | null;
  onCancel?: () => void;
  onToggleFocus: () => void;
  onBackToProjects: () => void;
  onSavePage: (pageNumber: number, markdown: string) => Promise<void>;
  onAnnotationsChanged?: () => void;
};

const STRIP_OPEN_KEY = "pto.review.stripOpen";

function loadStripOpen() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STRIP_OPEN_KEY) === "1";
}

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
  readOnly = false,
  showTech = false,
  specHref = null,
  specName = null,
  headerRight = null,
  onGoToLiveJob = null,
  liveJobLabel = null,
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
  const [split, setSplit] = useState(50);
  const [stripWidth, setStripWidth] = useState(108);
  // Миниатюры по умолчанию свёрнуты: место отдано чертежу и расшифровке.
  const [stripOpen, setStripOpen] = useState(loadStripOpen);
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
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [pdfHighlight, setPdfHighlight] = useState(0);
  const [paneSolo, setPaneSolo] = useState<PaneSolo>(null);
  const [galleryMode, setGalleryMode] = useState(false);
  const [scrollSync, setScrollSync] = useState(true);
  const [scrollRatio, setScrollRatio] = useState<number | null>(null);
  const [scrollAnchorY, setScrollAnchorY] = useState<number | null>(null);
  const [textRegions, setTextRegions] = useState<PageTextRegion[]>([]);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [hoverBlockId, setHoverBlockId] = useState<string | null>(null);
  const [hoverRegionId, setHoverRegionId] = useState<string | null>(null);
  const [sidePanel, setSidePanel] = useState<"text" | "notes">("text");
  const [searchOpen, setSearchOpen] = useState(false);
  /** Пользователь развернул прогресс поверх просмотра готового листа. */
  const [progressExpanded, setProgressExpanded] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(draft);
  const pageRef = useRef(rawPage);
  const timerRef = useRef<number | null>(null);
  const navigatedRef = useRef(false);
  const mdScrollRef = useRef<HTMLDivElement>(null);
  const syncLockRef = useRef(false);
  const deferredQuery = useDeferredValue(query);

  const total = Math.max(document.pageCount, document.pages.length, 1);
  const isCadSource = isCadExt(getDrawingExt(document.originalName));
  const processing =
    document.status === "queued" || document.status === "processing";
  const cancelPending = Boolean(document.errorMessage?.startsWith("Отмена"));
  const liveProcessing = processing || cancelPending;
  const activeProcessingPage = useMemo(() => {
    if (!liveProcessing) return null;
    if (document.processingPage && document.processingPage > 0) {
      return document.processingPage;
    }
    const ready = Math.min(Math.max(document.readyPages, 0), total);
    return ready < total ? ready + 1 : null;
  }, [document.processingPage, document.readyPages, liveProcessing, total]);
  const editedPages = useMemo(
    () => new Set(document.editLog.map((entry) => entry.pageNumber)),
    [document.editLog],
  );
  const kinds = useMemo(() => {
    const map = new Map<number, PageKind>();
    for (const item of document.pages) map.set(item.pageNumber, item.kind);
    return map;
  }, [document.pages]);
  const pageRecords = useMemo(() => {
    const map = new Map<number, (typeof document.pages)[number]>();
    for (const item of document.pages) map.set(item.pageNumber, item);
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
  const viewingProcessedSheet =
    liveProcessing && ready.has(pageNumber) && pageNumber !== activeProcessingPage;
  const showFullProgress =
    liveProcessing && (!viewingProcessedSheet || progressExpanded);

  useEffect(() => {
    if (viewingProcessedSheet) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgressExpanded(false);
    }
  }, [pageNumber, viewingProcessedSheet]);

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
    window.localStorage.setItem(STRIP_OPEN_KEY, stripOpen ? "1" : "0");
  }, [stripOpen]);

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

  function goToCurrentProcessing() {
    if (onGoToLiveJob) {
      onGoToLiveJob();
      return;
    }
    if (activeProcessingPage != null) {
      setProgressExpanded(false);
      void goToPage(activeProcessingPage);
    }
  }

  function stepVisible(delta: number) {
    const index = visiblePages.indexOf(pageRef.current);
    const fallback = delta > 0 ? visiblePages[0] : visiblePages[visiblePages.length - 1];
    const target = visiblePages[index + delta] ?? fallback;
    if (target) void goToPage(target);
  }

  function openSearch() {
    setSidePanel("text");
    setSearchOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
  }

  function toggleMark() {
    if (readOnly) return;
    setPendingRect(null);
    setMarkMode((value) => {
      const next = !value;
      if (next) setSidePanel("notes");
      return next;
    });
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

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openSearch();
        return;
      }

      if (event.key === "Escape") {
        if (moreMenuOpen) {
          setMoreMenuOpen(false);
          return;
        }
        if (galleryMode) {
          setGalleryMode(false);
          return;
        }
        if (showLog) {
          setShowLog(false);
          return;
        }
        if (searchOpen && (target === searchRef.current || !markMode)) {
          closeSearch();
          return;
        }
        if (markMode || pendingRect) {
          setMarkMode(false);
          setPendingRect(null);
          return;
        }
        if (paneSolo) {
          setPaneSolo(null);
          return;
        }
        if (focusMode) onToggleFocus();
        else onBackToProjects();
        return;
      }

      if (typing) return;

      if (event.key === "?" || (event.shiftKey && event.code === "Slash")) {
        event.preventDefault();
        setMoreMenuOpen((value) => !value);
        return;
      }

      // Дальше — одиночные клавиши: не перехватываем системные сочетания.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Сравниваем по event.code: работает и на русской раскладке.
      if (event.code === "Slash") {
        event.preventDefault();
        openSearch();
        return;
      }

      if (event.code === "KeyF") {
        event.preventDefault();
        if (galleryMode) setGalleryMode(false);
        setPaneSolo((prev) => (prev === null ? "pdf" : prev === "pdf" ? "md" : null));
        return;
      }

      if (event.code === "KeyG") {
        event.preventDefault();
        setGalleryMode((value) => !value);
        return;
      }

      if (galleryMode) return;

      if (event.code === "KeyV") {
        event.preventDefault();
        toggleViewed();
        return;
      }

      if (event.code === "KeyE") {
        event.preventDefault();
        toggleMark();
        return;
      }

      if (event.code === "KeyJ" || event.code === "Space") {
        event.preventDefault();
        stepVisible(1);
      }
      if (event.code === "KeyK") {
        event.preventDefault();
        stepVisible(-1);
      }
      if (event.key === "ArrowLeft") stepVisible(-1);
      if (event.key === "ArrowRight") stepVisible(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMode, markMode, pendingRect, onBackToProjects, onToggleFocus, visiblePages, document.pages, moreMenuOpen, showLog, paneSolo, searchOpen, readOnly, galleryMode]);

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

  function startSplit(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const parent = event.currentTarget.parentElement;
    if (!parent) return;
    const prevCursor = window.document.body.style.cursor;
    const prevSelect = window.document.body.style.userSelect;
    window.document.body.style.cursor = "col-resize";
    window.document.body.style.userSelect = "none";
    const move = (moveEvent: globalThis.MouseEvent) => {
      const rect = parent.getBoundingClientRect();
      const next = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setSplit(clamp(next, 22, 82));
    };
    const up = () => {
      window.document.body.style.cursor = prevCursor;
      window.document.body.style.userSelect = prevSelect;
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
  const errorCount = Object.keys(document.pageErrors ?? {}).length;

  const blockLinks = useMemo(() => {
    if (!page?.markdown || !textRegions.length) {
      return {
        byBlock: new Map<string, PageTextRegion>(),
        byRegion: new Map<string, string>(),
        anchors: new Map<string, number>(),
      };
    }
    return linkBlocksToRegions(parseMarkdownBlocks(page.markdown), textRegions);
  }, [page?.markdown, textRegions]);
  const blockAnchors = blockLinks.anchors;

  const hoverHighlightRegion = useMemo(() => {
    if (hoverBlockId) return blockLinks.byBlock.get(hoverBlockId) ?? null;
    if (hoverRegionId) {
      return textRegions.find((region) => region.id === hoverRegionId) ?? null;
    }
    return null;
  }, [blockLinks.byBlock, hoverBlockId, hoverRegionId, textRegions]);

  const linkedHoverRegions = useMemo(
    () => textRegions.filter((region) => blockLinks.byRegion.has(region.id)),
    [blockLinks.byRegion, textRegions],
  );

  useEffect(() => {
    setTextRegions([]);
    setScrollAnchorY(null);
    setActiveBlockId(null);
    setHoverBlockId(null);
    setHoverRegionId(null);
  }, [pageNumber, document.id]);

  function onHoverMarkdownBlock(blockId: string | null) {
    setHoverBlockId(blockId);
    if (blockId) setHoverRegionId(null);
  }

  function onHoverDrawingRegion(regionId: string | null) {
    setHoverRegionId(regionId);
    if (regionId) {
      const blockId = blockLinks.byRegion.get(regionId) ?? null;
      setHoverBlockId(blockId);
      if (blockId) {
        const el = mdScrollRef.current;
        const block = el?.querySelector(`[data-md-block="${blockId}"]`);
        if (block instanceof HTMLElement) {
          const parent = el!.getBoundingClientRect();
          const box = block.getBoundingClientRect();
          if (box.top < parent.top + 8 || box.bottom > parent.bottom - 8) {
            block.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
        }
      }
    } else {
      setHoverBlockId(null);
    }
  }

  function onMarkdownScroll() {
    if (!scrollSync || syncLockRef.current || paneSolo === "pdf") return;
    const el = mdScrollRef.current;
    if (!el) return;
    const blocks = el.querySelectorAll<HTMLElement>("[data-md-block]");
    const probe = el.scrollTop + 48;
    let current: HTMLElement | null = null;
    for (const block of blocks) {
      if (block.offsetTop <= probe) current = block;
      else break;
    }
    const blockId = current?.dataset.mdBlock ?? null;
    if (blockId) setActiveBlockId(blockId);

    syncLockRef.current = true;
    const anchorY = blockId ? blockAnchors.get(blockId) : null;
    if (anchorY != null) {
      setScrollAnchorY(anchorY);
      setScrollRatio(null);
    } else {
      const max = el.scrollHeight - el.clientHeight;
      const ratio = max <= 0 ? 0 : el.scrollTop / max;
      setScrollRatio(ratio);
      setScrollAnchorY(null);
    }
    requestAnimationFrame(() => {
      syncLockRef.current = false;
    });
  }

  function onPdfScrollRatio(ratio: number) {
    if (!scrollSync || syncLockRef.current || paneSolo === "md") return;
    syncLockRef.current = true;
    setScrollRatio(ratio);
    setScrollAnchorY(null);
    const el = mdScrollRef.current;
    if (el) {
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = ratio * Math.max(0, max);
    }
    requestAnimationFrame(() => {
      syncLockRef.current = false;
    });
  }

  function onPdfScrollAnchor(y: number) {
    if (!scrollSync || syncLockRef.current || paneSolo === "md") return;
    syncLockRef.current = true;
    setScrollAnchorY(y);
    setScrollRatio(null);
    const blockId = nearestBlockForAnchorY(y, blockAnchors);
    if (blockId) {
      setActiveBlockId(blockId);
      const el = mdScrollRef.current;
      const block = el?.querySelector(`[data-md-block="${blockId}"]`);
      if (block instanceof HTMLElement) {
        block.scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    } else {
      const el = mdScrollRef.current;
      if (el) {
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTop = y * Math.max(0, max);
      }
    }
    requestAnimationFrame(() => {
      syncLockRef.current = false;
    });
  }

  useEffect(() => {
    if (pendingRect) setSidePanel("notes");
  }, [pendingRect]);

  const soloLabel =
    paneSolo === "pdf" ? "Только чертёж" : paneSolo === "md" ? "Только текст" : null;

  const toolBtnIcon =
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-text shadow-sm hover:border-slate-400 hover:bg-slate-50";
  const toolBtnDanger =
    "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-red-500 bg-red-50 px-2.5 text-[11px] font-semibold text-red-700 shadow-sm";
  const toolBtnPrimary =
    "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-accent bg-accent px-2.5 text-[11px] font-semibold text-white shadow-sm hover:bg-[#1d4ed8]";

  const notesPanel = (
    <div className="flex min-h-0 flex-1 flex-col">
      {pendingRect ? (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-3 py-2">
          <div className="text-[11px] font-medium text-red-700">Новое замечание</div>
          <div className="mt-1 flex items-start gap-1.5">
            <textarea
              autoFocus
              value={noteComment}
              onChange={(event) => setNoteComment(event.target.value)}
              rows={2}
              placeholder="Что неверно"
              className="min-w-0 flex-1 resize-none rounded-md border border-border bg-white px-2 py-1.5 text-xs outline-none focus:border-accent"
            />
            <VoiceNoteButton
              onText={(text) =>
                setNoteComment((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
              }
            />
          </div>
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
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-3">
        {pageNotes.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-[#fafbfc] px-3 py-8 text-center text-[12px] leading-relaxed text-muted">
            Нажмите «Ошибка» и обведите место на чертеже
          </div>
        ) : (
          pageNotes.map((note, index) => (
            <div
              key={note.id}
              onMouseEnter={() => setActiveNoteId(note.id)}
              onMouseLeave={() => setActiveNoteId(null)}
              className={`rounded-md border px-2.5 py-2 text-[11px] ${
                note.status === "open"
                  ? "border-red-200 bg-red-50"
                  : "border-emerald-200 bg-emerald-50"
              } ${activeNoteId === note.id ? "ring-1 ring-accent/50" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  {index + 1}. {note.status === "open" ? "не проверено" : "исправлено"}
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
              <div className="mt-0.5 text-[10px] text-muted">
                {note.userName ? `${note.userName} · ` : ""}
                {formatDate(note.createdAt)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-white px-3">
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onBackToProjects}
            title="На главную (Esc)"
            className="flex items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs font-semibold text-text hover:border-accent hover:bg-white"
          >
            <span aria-hidden className="text-sm leading-none text-accent">
              ←
            </span>
            <span>На главную</span>
          </button>
          {liveProcessing && activeProcessingPage != null ? (
            <button
              type="button"
              onClick={goToCurrentProcessing}
              disabled={
                !onGoToLiveJob && pageNumber === activeProcessingPage && !progressExpanded
              }
              title="К текущему обрабатываемому листу"
              className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-950 hover:bg-sky-100 disabled:cursor-default disabled:opacity-50"
            >
              К обработке
              <span className="ml-1 tabular-nums opacity-80">
                · лист {activeProcessingPage}
              </span>
            </button>
          ) : null}
          {onGoToLiveJob ? (
            <button
              type="button"
              onClick={onGoToLiveJob}
              title={liveJobLabel ?? "К текущей обработке"}
              className="max-w-[14rem] truncate rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-950 hover:bg-sky-100"
            >
              К обработке
              {liveJobLabel ? (
                <span className="ml-1 font-normal opacity-80">· {liveJobLabel}</span>
              ) : null}
            </button>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight">
            {document.originalName}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
            <ActionMenu
              label="Выбрать лист и фильтр"
              align="left"
              menuClassName="top-full w-64"
              trigger={
                <>
                  {page ? KIND_LABEL[page.kind] : "Страница"} · лист {pageNumber} из{" "}
                  {total}
                  <span aria-hidden> ▾</span>
                </>
              }
              triggerClassName="-mx-1 shrink-0 rounded px-1 text-[11px] text-muted hover:bg-bg hover:text-text"
            >
              {/* Смена фильтра не должна закрывать меню: лист выбирают сразу после. */}
              <div className="px-2 pb-1.5 pt-1" onClick={(event) => event.stopPropagation()}>
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as KindFilter)}
                  aria-label="Фильтр листов по типу"
                  className="w-full cursor-pointer rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-semibold text-text outline-none focus:border-accent"
                >
                  {filters.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label} · {filterCounts[item.id]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="max-h-64 overflow-y-auto border-t border-border pt-1">
                {visiblePages.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] leading-snug text-muted">
                    {filter === "flagged"
                      ? "Замечаний по этому файлу пока нет."
                      : `Листов типа «${filterLabel}» в комплекте нет.`}
                  </div>
                ) : (
                  visiblePages.map((number) => {
                    const kind = kinds.get(number);
                    return (
                      <button
                        key={number}
                        type="button"
                        role="menuitem"
                        onClick={() => void goToPage(number)}
                        className={`${menuItemClass()} ${
                          number === pageNumber ? "bg-bg font-semibold" : ""
                        }`}
                      >
                        <span className="truncate">
                          Лист {number}
                          {kind ? ` · ${KIND_LABEL[kind].toLowerCase()}` : ""}
                        </span>
                        <span className="shrink-0 pl-2">
                          {annotatedPages.has(number) ? (
                            <span className="text-red-600" title="Есть замечание">
                              ●
                            </span>
                          ) : null}
                          {document.pageErrors?.[String(number)] ? (
                            <span className="text-amber-600" title="Ошибка обработки">
                              !
                            </span>
                          ) : null}
                          {viewedSet.has(number) ? (
                            <span className="text-accent" title="Просмотрено">
                              ✓
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </ActionMenu>
            <span className="truncate">
              {viewedSet.has(pageNumber) ? "· ✓" : ""}
              {openNotes ? ` · ${openNotes} зам.` : ""}
              {saving ? " · сохранение…" : ""}
            </span>
            <span className="shrink-0 tabular-nums" title="Просмотрено листов">
              · {viewed.length}/{total} просмотрено
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!readOnly ? (
            <button
              type="button"
              title={markMode ? "Отмена разметки (Esc)" : "Отметить ошибку (E)"}
              onClick={toggleMark}
              className={markMode ? toolBtnDanger : toolBtnPrimary}
            >
              <IconMark className="h-3.5 w-3.5" />
              {markMode ? "Отмена" : "Ошибка"}
            </button>
          ) : (
            <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-900">
              Просмотр
            </span>
          )}
          <button
            type="button"
            title={galleryMode ? "Вернуться к одному листу (G)" : "Все листы разом (G)"}
            aria-pressed={galleryMode}
            onClick={() => setGalleryMode((value) => !value)}
            className={
              galleryMode
                ? "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-accent bg-accent text-white shadow-sm"
                : toolBtnIcon
            }
          >
            <IconGrid />
          </button>
          <ActionMenu
            label="Ещё"
            triggerClassName={toolBtnIcon}
            open={moreMenuOpen}
            onOpenChange={setMoreMenuOpen}
            menuClassName="w-[min(22rem,calc(100vw-2rem))]"
          >
            <button
              type="button"
              role="menuitem"
              className={menuItemClass()}
              onClick={toggleViewed}
            >
              <span className="inline-flex items-center gap-2">
                <IconCheck />
                {viewedSet.has(pageNumber) ? "Снять просмотр" : "Просмотрено"}
              </span>
              <span className="text-[10px] text-muted">V</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuItemClass()}
              onClick={() => stepVisible(-1)}
              disabled={visiblePages[0] === pageNumber}
            >
              ← Предыдущий лист
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuItemClass()}
              onClick={() => stepVisible(1)}
              disabled={visiblePages[visiblePages.length - 1] === pageNumber}
            >
              → Следующий лист
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuItemClass()}
              onClick={() => (searchOpen ? closeSearch() : openSearch())}
            >
              <span className="inline-flex items-center gap-2">
                <IconSearch /> Поиск по файлу
              </span>
              <span className="text-[10px] text-muted">/</span>
            </button>
            <div className="my-1 border-t border-border" />
            <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Вид
            </div>
            <button
              type="button"
              role="menuitem"
              className={menuItemClass()}
              onClick={() => setGalleryMode((value) => !value)}
            >
              <span className="inline-flex items-center gap-2">
                <IconGrid /> {galleryMode ? "Один лист" : "Все листы"}
              </span>
              <span className="text-[10px] text-muted">G</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuItemClass()}
              onClick={() =>
                setPaneSolo((prev) => (prev === null ? "pdf" : prev === "pdf" ? "md" : null))
              }
            >
              <span className="inline-flex items-center gap-2">
                <IconSplit /> {soloLabel ? `Вид: ${soloLabel}` : "Вид: чертёж и текст"}
              </span>
              <span className="text-[10px] text-muted">F</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuItemClass()}
              onClick={() => setStripOpen((value) => !value)}
            >
              <span className="inline-flex items-center gap-2">
                <IconThumbs /> Миниатюры листов
              </span>
              <span className="text-[10px] text-muted">
                {stripOpen ? "вкл" : "выкл"}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuItemClass()}
              onClick={onToggleFocus}
            >
              <span className="inline-flex items-center gap-2">
                <IconExpand /> {focusMode ? "Свернуть на весь экран" : "Развернуть на весь экран"}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuItemClass()}
              onClick={() => setScrollSync((value) => !value)}
            >
              <span className="inline-flex items-center gap-2">
                <IconSync /> Синхронный скролл
              </span>
              <span className="text-[10px] text-muted">
                {scrollSync ? "вкл" : "выкл"}
              </span>
            </button>
            <div className="my-1 border-t border-border" />
            <a
              href={`/api/documents/${document.id}/markdown`}
              download
              role="menuitem"
              className={menuItemClass()}
            >
              <span className="inline-flex items-center gap-2">
                <IconDownload /> Скачать .md
              </span>
            </a>
            {specHref ? (
              <a
                href={specHref}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                className={menuItemClass()}
                title={specName ?? "ТЗ"}
              >
                <span className="inline-flex items-center gap-2">
                  <IconDoc /> Открыть ТЗ
                </span>
              </a>
            ) : null}
            {pageLogs.length ? (
              <button
                type="button"
                role="menuitem"
                className={menuItemClass()}
                onClick={() => setShowLog(true)}
              >
                <span>История правок листа</span>
                <span className="text-[10px] tabular-nums text-muted">
                  {pageLogs.length}
                </span>
              </button>
            ) : null}
            <ReviewPaneHelp />
            {soloLabel ? (
              <div className="px-3 py-1.5 text-[10px] text-muted">Режим: {soloLabel}</div>
            ) : null}
          </ActionMenu>
          {headerRight}
        </div>
      </div>

      {processing || cancelPending ? null : (
        <ProcessingSummaryStrip
          document={document}
          errorCount={errorCount}
        />
      )}

      {!processing &&
      !cancelPending &&
      (errorCount ||
        usageLabel ||
        (showTech && elapsedLabel) ||
        document.pipelineMode ||
        document.pipelineModel) ? (
        <div className="border-b border-border bg-[#fafbfc] px-4 py-1 text-[10px] text-muted">
          {document.pipelineMode === "mock" ? (
            <span className="text-amber-800">режим mock</span>
          ) : document.pipelineMode === "real" ? (
            <span>режим real</span>
          ) : null}
          {document.pipelineModel ? (
            <span className={document.pipelineMode ? "ml-2" : ""}>
              модель {document.pipelineModel}
            </span>
          ) : null}
          {usageLabel ? (
            <span
              className={
                document.pipelineMode || document.pipelineModel ? "ml-2" : ""
              }
            >
              {usageLabel}
            </span>
          ) : null}
          {errorCount ? (
            <span className="ml-2 text-red-700">ошибок листов: {errorCount}</span>
          ) : null}
          {showTech && elapsedLabel ? (
            <span className="ml-2">обработано за {elapsedLabel}</span>
          ) : null}
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        {galleryMode ? (
          <SheetsGallery
            documentId={document.id}
            fileUrl={`/api/documents/${document.id}/file`}
            isCad={isCadSource}
            pages={visiblePages}
            pageRecords={pageRecords}
            kinds={kinds}
            viewed={viewedSet}
            ready={ready}
            annotated={annotatedPages}
            edited={editedPages}
            processingPage={document.processingPage}
            currentPage={pageNumber}
            emptyLabel={
              filter === "flagged"
                ? "Замечаний по этому файлу пока нет."
                : `Листов типа «${filterLabel}» в комплекте нет.`
            }
            onSelect={(next) => {
              setGalleryMode(false);
              void goToPage(next);
            }}
          />
        ) : (
          <>
        {stripOpen ? (
          <>
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
              width={stripWidth}
              emptyLabel={
                filter === "flagged"
                  ? "Замечаний по этому файлу пока нет."
                  : `Листов типа «${filterLabel}» в комплекте нет.`
              }
              onSelect={(next) => void goToPage(next)}
            />
            <ColumnResizer
              onDelta={(dx) => setStripWidth((w) => clamp(w + dx, 72, 220))}
            />
          </>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1">
          {paneSolo !== "md" ? (
            <div
              className="relative min-h-0 min-w-0"
              style={{ width: paneSolo === "pdf" ? "100%" : `${split}%` }}
            >
              {isCadSource ? (
                <CadPage
                  documentId={document.id}
                  pageNumber={pageNumber}
                  annotations={pageNotes}
                  markMode={markMode && !readOnly}
                  activeAnnotationId={activeNoteId}
                  highlightNonce={pdfHighlight}
                  highlightQuery={deferredQuery}
                  scrollSync={scrollSync && paneSolo !== "pdf"}
                  scrollRatio={scrollSync && scrollAnchorY == null ? scrollRatio : null}
                  scrollAnchorY={scrollSync ? scrollAnchorY : null}
                  highlightAnchorY={scrollSync ? scrollAnchorY : null}
                  highlightRegion={hoverHighlightRegion}
                  panToHighlight={Boolean(hoverBlockId && !hoverRegionId)}
                  hoverRegions={linkedHoverRegions}
                  onScrollRatioChange={onPdfScrollRatio}
                  onScrollAnchorChange={onPdfScrollAnchor}
                  onTextRegionsReady={setTextRegions}
                  onHoverRegion={onHoverDrawingRegion}
                  onMarkRect={(rect) => setPendingRect(rect)}
                  onSelectAnnotation={(id) => setActiveNoteId(id)}
                  onCancelMark={() => {
                    setMarkMode(false);
                    setPendingRect(null);
                  }}
                />
              ) : (
                <PdfPage
                  url={`/api/documents/${document.id}/file`}
                  pageNumber={pageNumber}
                  annotations={pageNotes}
                  markMode={markMode && !readOnly}
                  activeAnnotationId={activeNoteId}
                  highlightNonce={pdfHighlight}
                  highlightQuery={deferredQuery}
                  scrollSync={scrollSync && paneSolo !== "pdf"}
                  scrollRatio={scrollSync && scrollAnchorY == null ? scrollRatio : null}
                  scrollAnchorY={scrollSync ? scrollAnchorY : null}
                  highlightAnchorY={scrollSync ? scrollAnchorY : null}
                  highlightRegion={hoverHighlightRegion}
                  panToHighlight={Boolean(hoverBlockId && !hoverRegionId)}
                  hoverRegions={linkedHoverRegions}
                  onScrollRatioChange={onPdfScrollRatio}
                  onScrollAnchorChange={onPdfScrollAnchor}
                  onTextRegionsReady={setTextRegions}
                  onHoverRegion={onHoverDrawingRegion}
                  onMarkRect={(rect) => setPendingRect(rect)}
                  onSelectAnnotation={(id) => setActiveNoteId(id)}
                  onCancelMark={() => {
                    setMarkMode(false);
                    setPendingRect(null);
                  }}
                />
              )}
              {liveProcessing ? (
                <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-slate-900/75 px-2.5 py-1 text-xs text-white">
                  {readyCount}/{total}
                  {activeProcessingPage ? ` · лист ${activeProcessingPage}` : ""}
                </div>
              ) : null}
            </div>
          ) : null}

          {paneSolo === null ? (
            <div
              role="separator"
              title="Потяните, чтобы изменить ширину чертежа и расшифровки"
              onMouseDown={startSplit}
              className="relative z-10 w-1 shrink-0 cursor-col-resize bg-border"
            >
              <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
            </div>
          ) : null}

          {paneSolo !== "pdf" ? (
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-white">
            {showFullProgress ? (
              <ProcessingProgressPanel
                document={document}
                canceling={canceling}
                onCancel={onCancel}
                onCollapse={
                  viewingProcessedSheet
                    ? () => setProgressExpanded(false)
                    : undefined
                }
              />
            ) : (
              <>
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <SegmentedTabs
                size="xs"
                value={sidePanel}
                onChange={setSidePanel}
                options={[
                  {
                    id: "text",
                    label: page?.kind === "table" ? "Таблица" : "Расшифровка",
                  },
                  {
                    id: "notes",
                    label: (
                      <>
                        Замечания
                        {pageNotes.length ? (
                          <span className="ml-1 tabular-nums opacity-70">
                            {pageNotes.length}
                          </span>
                        ) : null}
                      </>
                    ),
                  },
                ]}
              />
              <div className="flex items-center gap-2">
                {showTech && sidePanel === "text" && page ? (
                  <span className="text-[10px] text-muted">
                    {SOURCE_LABEL[page.source]}
                  </span>
                ) : null}
                {sidePanel === "text" && !readOnly ? (
                  <button
                    type="button"
                    aria-pressed={mode === "edit"}
                    title={
                      mode === "edit"
                        ? "Вернуться к чтению расшифровки"
                        : "Исправить расшифровку"
                    }
                    onClick={() => {
                      const next = mode === "edit" ? "view" : "edit";
                      if (next === "edit") setDraft(page?.markdown ?? "");
                      setMode(next);
                    }}
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
                      mode === "edit"
                        ? "border-accent bg-accent text-white"
                        : "border-border bg-white text-muted hover:bg-bg hover:text-text"
                    }`}
                  >
                    <IconPencil />
                  </button>
                ) : null}
              </div>
            </div>

            {sidePanel === "notes" ? (
              notesPanel
            ) : (
              <>
            {page && page.warnings.length > 0 ? (
              <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                {page.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            ) : null}

            {searchOpen ? (
              <div className="border-b border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Поиск по этому файлу: PSV, 210 кг, позиция…"
                    className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={closeSearch}
                    title="Закрыть поиск (Esc)"
                    className="shrink-0 rounded border border-border px-2 py-1 text-[11px] text-muted hover:bg-bg hover:text-text"
                  >
                    Esc
                  </button>
                </div>
                {query.trim().length >= 2 ? (
                  hits.length > 0 ? (
                    <div className="mt-2 max-h-32 space-y-1 overflow-auto">
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
                  ) : (
                    <div className="mt-2 text-[11px] text-muted">
                      Совпадений в этом файле нет.
                    </div>
                  )
                ) : null}
              </div>
            ) : null}

            <div
              ref={mdScrollRef}
              onScroll={onMarkdownScroll}
              className="min-h-0 flex-1 overflow-auto"
            >
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
                    highlightQuery={deferredQuery}
                    activeBlockId={scrollSync ? activeBlockId : null}
                    hoverBlockId={hoverBlockId}
                    onHoverBlock={onHoverMarkdownBlock}
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

              </>
            )}
              </>
            )}
          </div>
          ) : null}
        </div>

        {viewingProcessedSheet && !progressExpanded ? (
          <ProcessingCompactBadge
            live
            document={document}
            currentPage={
              pageNumber !== activeProcessingPage ? activeProcessingPage : null
            }
            onExpand={() => setProgressExpanded(true)}
            onGoToCurrent={
              activeProcessingPage != null && pageNumber !== activeProcessingPage
                ? goToCurrentProcessing
                : undefined
            }
            className={
              paneSolo === "pdf"
                ? "absolute bottom-14 right-3"
                : "absolute bottom-3 right-3"
            }
          />
        ) : null}
        {!liveProcessing ? (
          <ProcessingCompactBadge
            document={document}
            className={
              paneSolo === "pdf"
                ? "absolute bottom-14 right-3"
                : "absolute bottom-3 right-3"
            }
          />
        ) : null}
          </>
        )}
      </div>

      {showLog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="История правок листа"
          onClick={() => setShowLog(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium">
                Правки листа {pageNumber}
                {editedPages.has(pageNumber) ? " · текст меняли" : ""}
              </div>
              <button
                type="button"
                className="text-xs text-muted hover:text-text"
                onClick={() => setShowLog(false)}
              >
                Закрыть
              </button>
            </div>
            <div className="max-h-64 space-y-2 overflow-auto">
              {pageLogs.length === 0 ? (
                <div className="text-xs text-muted">По этому листу правок ещё нет.</div>
              ) : (
                pageLogs.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md bg-surface-2 px-2 py-1.5 text-[11px] text-muted"
                  >
                    {formatDate(entry.createdAt)} · лист {entry.pageNumber}
                    {entry.userName ? ` · ${entry.userName}` : ""}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
