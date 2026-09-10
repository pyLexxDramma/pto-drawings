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
import {
  IconCheck,
  IconDoc,
  IconExpand,
  IconMark,
  IconSearch,
} from "@/components/tool-icons";
import { formatDate } from "@/lib/format";
import { getDrawingExt, isCadExt, isOfficeExt } from "@/lib/drawing-files";
import {
  ProcessingProgressPanel,
} from "@/components/processing-progress-panel";
import {
  getDocumentView,
  patchDocumentView,
} from "@/lib/review-view-cache";
import {
  cacheProgress,
  fetchProgress,
  loadCachedProgress,
  pushProgress,
} from "@/lib/review-state";
import {
  KIND_LABEL,
  REVIEW_SEVERITY_LABEL,
  type AnnotationRect,
  type DocumentRecord,
  type PageAnnotation,
  type PageKind,
  type Review,
} from "@/types";

type KindFilter = "all" | "drawing" | "table" | "text" | "flagged";
type PaneSolo = null | "pdf" | "md";

type ReviewPaneProps = {
  document: DocumentRecord;
  /** Замечания проекта из таблицы — счётчик по листам и подсветка мест. */
  reviews?: Review[];
  focusMode: boolean;
  openPage?: {
    nonce: number;
    page: number;
    documentId: string;
    reviewId?: string;
    quote?: string;
  } | null;
  canceling?: boolean;
  readOnly?: boolean;
  /** Технические метрики прогона (токены, режим) — только для админа. */
  showTech?: boolean;
  specHref?: string | null;
  specName?: string | null;
  /**
   * Правый край шапки: меню пользователя и статус конвейера из workspace.
   * Действия по листу отдаём аргументом — они живут в меню пользователя,
   * чтобы над чертежом осталась только кнопка «Ошибка» (решение Дархана 09.09).
   */
  headerRight?: ((sheetMenu: ReactNode) => ReactNode) | null;
  /** Переход к активной обработке в другом файле проекта (если есть). */
  onGoToLiveJob?: (() => void) | null;
  liveJobLabel?: string | null;
  /** Файл с активной обработкой в проекте (может отличаться от открытого). */
  activeJobDocument?: DocumentRecord | null;
  /** Связанный PDF или DWG из комплекта kitId. */
  kitSibling?: DocumentRecord | null;
  /** Сообщить workspace: развёрнутая панель прогресса занимает правую колонку. */
  onFullProgressVisible?: (visible: boolean) => void;
  onCancel?: () => void;
  onToggleFocus: () => void;
  onBackToProjects: () => void;
  onAnnotationsChanged?: () => void;
};

function canScrollX(element: HTMLElement) {
  if (element.scrollWidth - element.clientWidth <= 1) return false;
  const overflow = window.getComputedStyle(element).overflowX;
  return overflow === "auto" || overflow === "scroll";
}

function stepLabel(document: DocumentRecord) {
  if (document.status === "queued") return "в очереди";
  if (document.processingStep === "text") return "текст и таблицы";
  if (document.processingStep === "drawings") return "чертёж";
  return "обработка";
}

function jobLiveProcessing(doc: DocumentRecord) {
  return (
    doc.status === "queued" ||
    doc.status === "processing" ||
    Boolean(doc.errorMessage?.startsWith("Отмена"))
  );
}

function activePageForJob(doc: DocumentRecord) {
  const total = Math.max(doc.pageCount, doc.pages.length, 1);
  if (!jobLiveProcessing(doc)) return null;
  if (doc.processingPage && doc.processingPage > 0) {
    return doc.processingPage;
  }
  const ready = Math.min(Math.max(doc.readyPages, 0), total);
  return ready < total ? ready + 1 : null;
}

export function ReviewPane({
  document,
  reviews = [],
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
  activeJobDocument = null,
  kitSibling = null,
  onFullProgressVisible,
  onCancel,
  onToggleFocus,
  onBackToProjects,
  onAnnotationsChanged,
}: ReviewPaneProps) {
  const [rawPage, setRawPage] = useState(() => {
    const cached = getDocumentView(document.id);
    if (cached?.pageNumber && cached.pageNumber > 0) return cached.pageNumber;
    return loadCachedProgress(document.id).lastPage;
  });
  const [split, setSplit] = useState(50);
  const [stripWidth, setStripWidth] = useState(108);
  // Миниатюры по умолчанию свёрнуты: место отдано чертежу и расшифровке.
  /** Миниатюры убрали из меню: путали инженеров. Полосу оставляем выключенной. */
  const [stripOpen] = useState(false);
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
  const [hoverNoteId, setHoverNoteId] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [paneSolo, setPaneSolo] = useState<PaneSolo>(() => {
    const cached = getDocumentView(document.id);
    return cached?.paneSolo ?? null;
  });
  const [sidePanel, setSidePanel] = useState<"text" | "notes">("text");
  const [searchOpen, setSearchOpen] = useState(false);
  /** Пользователь развернул прогресс поверх просмотра готового листа. */
  const [progressExpanded, setProgressExpanded] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef(rawPage);
  const navigatedRef = useRef(false);
  const textPaneRef = useRef<HTMLDivElement>(null);
  const deferredQuery = useDeferredValue(query);
  /** Цитата из «Где в ПД»: подсветка в тексте и на чертеже. */
  const [focusQuote, setFocusQuote] = useState("");
  const [focusNonce, setFocusNonce] = useState(0);

  const total = Math.max(document.pageCount, document.pages.length, 1);
  const isCadSource = isCadExt(getDrawingExt(document.originalName));
  const isOfficeSource = isOfficeExt(getDrawingExt(document.originalName));
  const kitPdfDoc = useMemo(() => {
    if (isOfficeSource) return null;
    if (isCadSource) {
      return kitSibling && !isCadExt(getDrawingExt(kitSibling.originalName))
        ? kitSibling
        : null;
    }
    return document;
  }, [document, kitSibling, isCadSource, isOfficeSource]);
  const kitCadDoc = useMemo(() => {
    if (isOfficeSource) return null;
    if (isCadSource) return document;
    return kitSibling && isCadExt(getDrawingExt(kitSibling.originalName))
      ? kitSibling
      : null;
  }, [document, kitSibling, isCadSource, isOfficeSource]);
  const hasKitDrawing = Boolean(kitPdfDoc && kitCadDoc);
  const [kitDrawingView, setKitDrawingView] = useState<"pdf" | "cad">(
    isCadSource ? "cad" : "pdf",
  );
  useEffect(() => {
    setKitDrawingView(isCadSource ? "cad" : "pdf");
  }, [document.id, isCadSource]);
  useEffect(() => {
    if (isOfficeSource && paneSolo === null) setPaneSolo("md");
  }, [document.id, isOfficeSource]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Широкие таблицы: горизонтальный скролл на панели (полоса внизу окна),
   * не внизу всего текста. Shift/трекпад — влево-вправо.
   */
  useEffect(() => {
    const pane = textPaneRef.current;
    if (!pane) return;
    const onWheel = (event: WheelEvent) => {
      const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
      if (!dx) return;
      if (!canScrollX(pane)) return;
      event.preventDefault();
      pane.scrollLeft += dx;
    };
    pane.addEventListener("wheel", onWheel, { passive: false });
    return () => pane.removeEventListener("wheel", onWheel);
  }, [paneSolo, document.id]);
  const processing =
    document.status === "queued" || document.status === "processing";
  const cancelPending = Boolean(document.errorMessage?.startsWith("Отмена"));
  const liveProcessing = processing || cancelPending;
  const progressDocument =
    activeJobDocument && jobLiveProcessing(activeJobDocument)
      ? activeJobDocument
      : liveProcessing
        ? document
        : null;
  const progressIsCurrentDoc = progressDocument?.id === document.id;
  const progressLive = progressDocument ? jobLiveProcessing(progressDocument) : false;
  const activeProcessingPage = useMemo(
    () => (progressDocument ? activePageForJob(progressDocument) : null),
    [progressDocument],
  );
  const editedPages = useMemo(
    () => new Set(document.editLog.map((entry) => entry.pageNumber)),
    [document.editLog],
  );

  /**
   * Замечания таблицы, разложенные по листам этого файла: инженер сразу видит,
   * где конвейер что-то нашёл, и не листает комплект наугад.
   */
  const reviewsByPage = useMemo(() => {
    const map = new Map<number, Review[]>();
    for (const review of reviews) {
      if (review.severity === "skip") continue;
      for (const location of review.locations) {
        if (location.documentId !== document.id) continue;
        if (!location.pageNumber) continue;
        const list = map.get(location.pageNumber);
        if (list) {
          if (!list.some((item) => item.id === review.id)) list.push(review);
        } else {
          map.set(location.pageNumber, [review]);
        }
      }
    }
    return map;
  }, [document.id, reviews]);
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
  const drawingPdfPage = kitPdfDoc
    ? Math.min(
        pageNumber,
        Math.max(kitPdfDoc.pageCount, kitPdfDoc.pages.length, 1),
      )
    : pageNumber;
  const drawingCadPage = kitCadDoc
    ? Math.min(
        pageNumber,
        Math.max(kitCadDoc.pageCount, kitCadDoc.pages.length, 1),
      )
    : pageNumber;
  const page = document.pages.find((item) => item.pageNumber === pageNumber);
  const pageNotes = notes.filter((item) => item.pageNumber === pageNumber);
  const pageReviews = reviewsByPage.get(pageNumber) ?? [];
  const pageReviewQuotes = pageReviews
    .flatMap((review) =>
      review.locations
        .filter(
          (location) =>
            location.documentId === document.id &&
            location.pageNumber === pageNumber,
        )
        .map((location) => location.quote),
    )
    .filter((quote) => quote.trim().length > 0);
  /** Ищем на чертеже: сначала цитата из ссылки, иначе строка поиска.
   * PDF/CAD text items короткие — для длинной цитаты берём начало. */
  const drawingHighlightQuery = (() => {
    const raw =
      focusQuote.trim().length >= 2 ? focusQuote.trim() : deferredQuery.trim();
    if (raw.length <= 56) return raw;
    const cut = raw.slice(0, 56).replace(/\s+\S*$/, "");
    return cut.length >= 2 ? cut : raw.slice(0, 40);
  })();
  /** В расшифровке — полная цитата (мигание всех вхождений). */
  const textHighlightQuery =
    focusQuote.trim().length >= 2 ? focusQuote.trim() : deferredQuery;
  const focusDrawing = focusQuote.trim().length >= 2;
  const activeNoteId = hoverNoteId;
  const viewingProcessedSheet =
    progressIsCurrentDoc &&
    progressLive &&
    ready.has(pageNumber) &&
    pageNumber !== activeProcessingPage;
  const showFullProgress =
    progressIsCurrentDoc &&
    progressLive &&
    (!viewingProcessedSheet || progressExpanded);

  useEffect(() => {
    onFullProgressVisible?.(showFullProgress);
    return () => onFullProgressVisible?.(false);
  }, [showFullProgress, onFullProgressVisible]);

  useEffect(() => {
    if (viewingProcessedSheet) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgressExpanded(false);
    }
  }, [pageNumber, viewingProcessedSheet]);

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
    const quote = (openPage.quote ?? "").trim();
    setFocusQuote(quote);
    if (quote) setFocusNonce(Date.now());
  }, [document.id, openPage]);

  // Цитата из reviewId, если workspace ещё не дописал quote в openPage.
  useEffect(() => {
    if (focusQuote.trim().length >= 2) return;
    const reviewId = openPage?.reviewId;
    if (!reviewId || openPage.documentId !== document.id) return;
    const review = reviews.find((item) => item.id === reviewId);
    if (!review) return;
    const location =
      review.locations.find(
        (item) =>
          item.documentId === document.id &&
          item.pageNumber === (openPage.page || pageNumber),
      ) ??
      review.locations.find((item) => item.documentId === document.id) ??
      review.locations[0];
    const quote = location?.quote?.trim() ?? "";
    if (quote.length < 2) return;
    setFocusQuote(quote);
    setFocusNonce(Date.now());
  }, [focusQuote, openPage, reviews, document.id, pageNumber]);

  // После появления markdown / смены листа — к цитате в расшифровке.
  useEffect(() => {
    if (!focusQuote || focusNonce === 0) return;
    const timer = window.setTimeout(() => {
      const mark = textPaneRef.current?.querySelector("mark[data-focus-quote]");
      mark?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [focusQuote, focusNonce, pageNumber, document.id, page?.markdown]);

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

  /**
   * Текст расшифровки не правится руками (решение Дархана 09.09): исправления
   * идут только через «Ошибка» — тогда у конвейера остаётся, чему учиться.
   */
  function goToPage(next: number) {
    navigatedRef.current = true;
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

  const canPrevPage = visiblePages[0] !== pageNumber;
  const canNextPage = visiblePages[visiblePages.length - 1] !== pageNumber;
  const pageNav = {
    onPrevPage: () => stepVisible(-1),
    onNextPage: () => stepVisible(1),
    canPrevPage,
    canNextPage,
  };

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

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openSearch();
        return;
      }

      if (event.key === "Escape") {
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
        setPaneSolo((prev) => (prev === null ? "pdf" : prev === "pdf" ? "md" : null));
        return;
      }

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
  }, [focusMode, markMode, pendingRect, onBackToProjects, onToggleFocus, visiblePages, document.pages, showLog, paneSolo, searchOpen, readOnly]);

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
    if (hoverNoteId === note.id) setHoverNoteId(null);
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
  const pageError = document.pageErrors?.[String(pageNumber)] ?? null;
  const pageWarning = document.pageWarnings?.[String(pageNumber)] ?? null;
  const isMockPage = Boolean(page?.markdown.includes("[MOCK]"));
  const errorCount = Object.keys(document.pageErrors ?? {}).length;
  const suspectNumbers =
    page?.numbers?.suspect?.filter((item) => item.trim().length > 0) ?? [];

  useEffect(() => {
    setHoverNoteId(null);
  }, [pageNumber, document.id]);

  useEffect(() => {
    patchDocumentView(document.id, {
      pageNumber,
      paneSolo,
    });
  }, [document.id, pageNumber, paneSolo]);

  useEffect(() => {
    if (pendingRect) setSidePanel("notes");
  }, [pendingRect]);

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
              onMouseEnter={() => setHoverNoteId(note.id)}
              onMouseLeave={() => setHoverNoteId(null)}
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
      <div className="flex h-10 shrink-0 items-center justify-end gap-1.5 border-b border-border bg-white px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {liveProcessing && activeProcessingPage != null ? (
            <button
              type="button"
              onClick={goToCurrentProcessing}
              disabled={
                !onGoToLiveJob && pageNumber === activeProcessingPage && !progressExpanded
              }
              title="К текущему обрабатываемому листу"
              className="shrink-0 rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-950 hover:bg-sky-100 disabled:cursor-default disabled:opacity-50"
            >
              К обработке · {activeProcessingPage}
            </button>
          ) : null}
          {onGoToLiveJob ? (
            <button
              type="button"
              onClick={onGoToLiveJob}
              title={liveJobLabel ?? "К текущей обработке"}
              className="max-w-[12rem] shrink-0 truncate rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-950 hover:bg-sky-100"
            >
              К обработке
              {liveJobLabel ? (
                <span className="ml-1 font-normal opacity-80">· {liveJobLabel}</span>
              ) : null}
            </button>
          ) : null}
          <ActionMenu
            label="Фильтр и список листов"
            align="left"
            menuClassName="top-full w-64"
            trigger={
              <>
                {page ? KIND_LABEL[page.kind] : "Страница"}
                {viewedSet.has(pageNumber) ? " · ✓" : ""}
                {openNotes ? ` · ${openNotes} зам.` : ""}
                <span aria-hidden> ▾</span>
              </>
            }
            triggerClassName="shrink-0 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-950 hover:bg-emerald-100"
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
                          {reviewsByPage.get(number)?.length ? (
                            <span
                              className="mr-1 rounded bg-violet-100 px-1 text-[10px] font-semibold tabular-nums text-violet-900"
                              title={`Замечаний из таблицы: ${
                                reviewsByPage.get(number)!.length
                              }`}
                            >
                              {reviewsByPage.get(number)!.length}
                            </span>
                          ) : null}
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
                          {!document.pageErrors?.[String(number)] &&
                          document.pageWarnings?.[String(number)] ? (
                            <span
                              className="text-orange-500"
                              title={document.pageWarnings[String(number)]}
                            >
                              △
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
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isOfficeSource ? (
            <div className="flex items-center rounded-md border border-slate-300 bg-white shadow-sm">
              <button
                type="button"
                title="Предыдущий лист (K / ←)"
                onClick={() => stepVisible(-1)}
                disabled={visiblePages[0] === pageNumber}
                className="inline-flex h-8 w-8 items-center justify-center rounded-l-md text-text hover:bg-slate-50 disabled:cursor-default disabled:opacity-40"
              >
                ←
              </button>
              <button
                type="button"
                title="Следующий лист (J / → / пробел)"
                onClick={() => stepVisible(1)}
                disabled={visiblePages[visiblePages.length - 1] === pageNumber}
                className="inline-flex h-8 w-8 items-center justify-center border-l border-slate-300 text-text hover:bg-slate-50 disabled:cursor-default disabled:opacity-40"
              >
                →
              </button>
              <button
                type="button"
                title={searchOpen ? "Закрыть поиск (Esc)" : "Поиск по файлу (/ или Ctrl+F)"}
                onClick={() => (searchOpen ? closeSearch() : openSearch())}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-r-md border-l border-slate-300 hover:bg-slate-50 ${
                  searchOpen ? "bg-sky-50 text-sky-900" : "text-text"
                }`}
              >
                <IconSearch className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              title={searchOpen ? "Закрыть поиск (Esc)" : "Поиск по файлу (/ или Ctrl+F)"}
              onClick={() => (searchOpen ? closeSearch() : openSearch())}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white shadow-sm hover:bg-slate-50 ${
                searchOpen ? "bg-sky-50 text-sky-900" : "text-text"
              }`}
            >
              <IconSearch className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            title={
              viewedSet.has(pageNumber)
                ? "Снять отметку «просмотрено» (V)"
                : "Отметить лист просмотренным (V)"
            }
            onClick={toggleViewed}
            className={`${toolBtnIcon} ${
              viewedSet.has(pageNumber)
                ? "border-accent/40 bg-accent/5 text-accent"
                : ""
            }`}
          >
            <IconCheck className="h-3.5 w-3.5" />
          </button>
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
          {headerRight?.(
            <>
            <button
              type="button"
              role="menuitem"
              className={menuItemClass()}
              onClick={onToggleFocus}
            >
              <span className="inline-flex items-center gap-2">
                <IconExpand /> {focusMode ? "Свернуть на весь экран" : "На весь экран"}
              </span>
            </button>
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
            </>,
          )}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {stripOpen && !isOfficeSource ? (
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
              {hasKitDrawing ? (
                <div className="absolute left-2 top-2 z-20">
                  <SegmentedTabs
                    size="xs"
                    value={kitDrawingView}
                    onChange={(value) => setKitDrawingView(value as "pdf" | "cad")}
                    options={[
                      { id: "pdf", label: "PDF" },
                      { id: "cad", label: "DWG" },
                    ]}
                  />
                </div>
              ) : null}
              {hasKitDrawing && kitDrawingView === "cad" && kitCadDoc ? (
                <CadPage
                  documentId={kitCadDoc.id}
                  pageNumber={drawingCadPage}
                  annotations={pageNotes}
                  markMode={markMode && !readOnly}
                  activeAnnotationId={activeNoteId}
                  highlightQuery={drawingHighlightQuery}
                  panToHighlight={focusDrawing}
                  remarkFocus={focusDrawing}
                  highlightNonce={focusNonce}
                  {...pageNav}
                  onMarkRect={(rect) => setPendingRect(rect)}
                  onSelectAnnotation={(id) => setHoverNoteId(id)}
                  onCancelMark={() => {
                    setMarkMode(false);
                    setPendingRect(null);
                  }}
                />
              ) : hasKitDrawing && kitDrawingView === "pdf" && kitPdfDoc ? (
                <PdfPage
                  url={`/api/documents/${kitPdfDoc.id}/file`}
                  pageNumber={drawingPdfPage}
                  viewCacheKey={kitPdfDoc.id}
                  annotations={pageNotes}
                  markMode={markMode && !readOnly}
                  activeAnnotationId={activeNoteId}
                  highlightQuery={drawingHighlightQuery}
                  panToHighlight={focusDrawing}
                  remarkFocus={focusDrawing}
                  highlightNonce={focusNonce}
                  {...pageNav}
                  onMarkRect={(rect) => setPendingRect(rect)}
                  onSelectAnnotation={(id) => setHoverNoteId(id)}
                  onCancelMark={() => {
                    setMarkMode(false);
                    setPendingRect(null);
                  }}
                />
              ) : isCadSource ? (
                <CadPage
                  documentId={document.id}
                  pageNumber={pageNumber}
                  annotations={pageNotes}
                  markMode={markMode && !readOnly}
                  activeAnnotationId={activeNoteId}
                  highlightQuery={drawingHighlightQuery}
                  panToHighlight={focusDrawing}
                  remarkFocus={focusDrawing}
                  highlightNonce={focusNonce}
                  {...pageNav}
                  onMarkRect={(rect) => setPendingRect(rect)}
                  onSelectAnnotation={(id) => setHoverNoteId(id)}
                  onCancelMark={() => {
                    setMarkMode(false);
                    setPendingRect(null);
                  }}
                />
              ) : isOfficeSource ? (
                <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 bg-[#f7f8fa] px-6 text-center text-sm text-muted">
                  <div className="font-medium text-text">Документ Word</div>
                  <div>
                    Чертежа нет — текст расшифровки справа. Исходный файл можно
                    скачать из меню.
                  </div>
                </div>
              ) : (
                <PdfPage
                  url={`/api/documents/${document.id}/file`}
                  pageNumber={pageNumber}
                  viewCacheKey={document.id}
                  annotations={pageNotes}
                  markMode={markMode && !readOnly}
                  activeAnnotationId={activeNoteId}
                  highlightQuery={drawingHighlightQuery}
                  panToHighlight={focusDrawing}
                  remarkFocus={focusDrawing}
                  highlightNonce={focusNonce}
                  {...pageNav}
                  onMarkRect={(rect) => setPendingRect(rect)}
                  onSelectAnnotation={(id) => setHoverNoteId(id)}
                  onCancelMark={() => {
                    setMarkMode(false);
                    setPendingRect(null);
                  }}
                />
              )}
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
                showTech={showTech}
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
            <div className="flex items-center gap-1.5 border-b border-border px-2 py-1">
              <button
                type="button"
                onClick={() => setSidePanel("text")}
                className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${
                  sidePanel === "text"
                    ? "border-teal-600 bg-teal-600 text-white"
                    : "border-teal-300 bg-teal-50 text-teal-950 hover:bg-teal-100"
                }`}
              >
                {page?.kind === "table" ? "Таблица" : "Расшифровка"}
              </button>
              <button
                type="button"
                onClick={() => setSidePanel("notes")}
                className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${
                  sidePanel === "notes"
                    ? "border-rose-600 bg-rose-600 text-white"
                    : "border-rose-300 bg-rose-50 text-rose-950 hover:bg-rose-100"
                }`}
              >
                Отметить ошибку
                {pageNotes.length ? (
                  <span className="ml-1 tabular-nums opacity-80">
                    {pageNotes.length}
                  </span>
                ) : null}
              </button>
              {hasKitDrawing && sidePanel === "text" ? (
                <span
                  className="truncate text-[10px] text-muted"
                  title="Единая расшифровка после сверки — в работе у бэкенда"
                >
                  PDF · DWG для сверки
                </span>
              ) : null}
              {sidePanel === "text" && page?.source === "model" ? (
                <span
                  className="ml-auto truncate text-[10px] text-orange-700"
                  title="Текстового слоя нет — содержимое прочитано по изображению; сверьте числа и марки с оригиналом"
                >
                  По изображению · сверить
                </span>
              ) : null}
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

            {pageWarning && !(page && page.warnings.length > 0) ? (
              <div className="border-b border-orange-200 bg-orange-50 px-3 py-2 text-[11px] text-orange-900">
                {pageWarning}
              </div>
            ) : null}

            {suspectNumbers.length > 0 ? (
              <div className="border-b border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-900">
                <div className="font-medium">Числа для сверки с оригиналом</div>
                <div className="mt-0.5 break-words">
                  {suspectNumbers.join(" · ")}
                </div>
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
              ref={textPaneRef}
              className="min-h-0 flex-1 overflow-x-scroll overflow-y-auto [scrollbar-gutter:stable]"
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
              ) : (
                <div
                  className={`markdown-body p-5 ${page.kind === "table" ? "markdown-body--table" : ""}`}
                >
                  {pageError ? (
                    <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      Ошибка листа: {pageError}
                    </div>
                  ) : null}
                  {showTech && isMockPage ? (
                    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                      Это ответ режима [MOCK], не работа модели.
                    </div>
                  ) : null}
                  {/* Что нашёл конвейер на этом листе: места в тексте
                      подсвечены розовым, чтобы не искать их глазами. */}
                  {pageReviews.length > 0 ? (
                    <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                      <div className="font-medium">
                        Замечаний по листу: {pageReviews.length}
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {pageReviews.map((review) => (
                          <li key={review.id} className="leading-snug">
                            <span className="font-medium tabular-nums">
                              № {review.number}
                            </span>
                            {` · ${REVIEW_SEVERITY_LABEL[
                              review.severity
                            ].toLowerCase()} · ${
                              review.text || review.aiFinding
                            }`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <MarkdownView
                    singlePass={page.kind === "table"}
                    highlightQuery={textHighlightQuery}
                    focusFirst={focusDrawing}
                    flagQuotes={pageReviewQuotes}
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
