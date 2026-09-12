"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { ColumnResizer, clamp } from "@/components/column-resizer";
import { CadPage } from "@/components/cad-page";
import { MarkdownView } from "@/components/markdown-view";
import { PageStrip } from "@/components/page-strip";
import { PdfPage } from "@/components/pdf-page";
import { RemarkRail } from "@/components/remark-rail";
import { PaneToggle, SegmentedTabs } from "@/components/ui-chrome";
import { IconChevronLeft, IconChevronRight } from "@/components/tool-icons";
import { KEYMAP, KEYMAP_GROUPS } from "@/lib/keymap";
import {
  loadViewerPrefs,
  saveViewerPrefs,
} from "@/lib/viewer-prefs";
import { VoiceNoteButton } from "@/components/voice-note";
import { formatDate } from "@/lib/format";
import { getDrawingExt, isCadExt, isOfficeExt } from "@/lib/drawing-files";
import {
  ProcessingProgressPanel,
} from "@/components/processing-progress-panel";
import {
  getDocumentView,
  patchDocumentView,
} from "@/lib/review-view-cache";
import { normalizeQuote } from "@/lib/remark-jump";
import {
  cacheProgress,
  fetchProgress,
  loadCachedProgress,
  pushProgress,
} from "@/lib/review-state";
import {
  REVIEW_SEVERITY_LABEL,
  type AnnotationRect,
  type DocumentRecord,
  type PageAnnotation,
  type PageKind,
  type Review,
  type ReviewSeverity,
} from "@/types";

type KindFilter = "all" | "drawing" | "table" | "text" | "flagged";
type PaneSolo = null | "pdf" | "md";

type ReviewPaneProps = {
  document: DocumentRecord;
  projectId?: string;
  /** Замечания проекта из таблицы — счётчик по листам и подсветка мест. */
  reviews?: Review[];
  onReviewPatched?: (review: Review) => void;
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
  /** Открыть историю правок текущего листа — пункт в верхнем меню пользователя. */
  onPageLogReady?: (api: { open: () => void; count: number } | null) => void;
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
  projectId,
  reviews = [],
  onReviewPatched,
  focusMode,
  openPage,
  canceling = false,
  readOnly = false,
  showTech = false,
  onPageLogReady,
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
  const [stripWidth, setStripWidth] = useState(160);
  const [stripOpen, setStripOpen] = useState(() => loadViewerPrefs().thumbs);
  const [railOpen, setRailOpen] = useState(() => loadViewerPrefs().remarks);
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
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [keymapOpen, setKeymapOpen] = useState(false);
  const [drawingHitCount, setDrawingHitCount] = useState(0);
  const [textHitFound, setTextHitFound] = useState<boolean | null>(null);
  const handleHighlightHits = useCallback((count: number) => {
    setDrawingHitCount(count);
  }, []);

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
  const fileReviews = useMemo(
    () =>
      reviews.filter(
        (review) =>
          review.severity !== "skip" &&
          review.locations.some((loc) => loc.documentId === document.id),
      ),
    [document.id, reviews],
  );
  async function patchReview(reviewId: string, body: Partial<Review>) {
    if (!projectId) return;
    try {
      const response = await fetch(
        `/api/projects/${projectId}/reviews/${reviewId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as { review: Review };
      onReviewPatched?.(payload.review);
    } catch {
      // разбор не блокирует просмотр
    }
  }
  function focusReviewOnSheet(review: (typeof pageReviews)[number]) {
    const location =
      review.locations.find(
        (item) =>
          item.documentId === document.id && item.pageNumber === pageNumber,
      ) ??
      review.locations.find((item) => item.documentId === document.id) ??
      review.locations[0];
    const quote = (
      location?.quote ||
      review.text ||
      review.aiFinding ||
      ""
    ).trim();
    if (quote.length < 2) return;
    setActiveReviewId(review.id);
    setFocusQuote(quote);
    setFocusNonce(Date.now());
    setPaneSolo(null);
    setSidePanel("text");
    setDrawingHitCount(0);
    setTextHitFound(null);
  }
  function selectFileReview(review: Review) {
    const location =
      review.locations.find((item) => item.documentId === document.id) ??
      review.locations[0];
    if (location?.pageNumber) goToPage(location.pageNumber);
    focusReviewOnSheet(review);
  }

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
    if (openPage.reviewId) setActiveReviewId(openPage.reviewId);
    if (quote || openPage.reviewId) {
      setFocusNonce(Date.now());
      setPaneSolo(null);
      setSidePanel("text");
    }
  }, [document.id, openPage]);

  // Счётчики совпадений обнуляем только при смене цитаты/листа, иначе
  // повторный рендер openPage затирал уже найденные попадания.
  useEffect(() => {
    setDrawingHitCount(0);
    setTextHitFound(null);
  }, [focusQuote, document.id, pageNumber]);

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
    setPaneSolo(null);
    setSidePanel("text");
  }, [focusQuote, openPage, reviews, document.id, pageNumber]);

  // После появления markdown / смены листа — к цитате в расшифровке.
  useEffect(() => {
    if (!focusQuote || focusNonce === 0) return;
    if (paneSolo === "pdf" || sidePanel !== "text") {
      setTextHitFound(null);
      return;
    }
    let cancelled = false;
    let tries = 0;
    const tick = () => {
      if (cancelled) return;
      const mark = textPaneRef.current?.querySelector("mark[data-focus-quote]");
      if (mark) {
        // Только скролл к цитате — без зума; весь фрагмент в кадре расшифровки.
        mark.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        const pane = textPaneRef.current;
        if (pane) {
          const m = mark.getBoundingClientRect();
          const p = pane.getBoundingClientRect();
          if (m.top < p.top + 8 || m.bottom > p.bottom - 8) {
            mark.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
          }
        }
        setTextHitFound(true);
        return;
      }
      tries += 1;
      if (tries < 10) {
        window.setTimeout(tick, 200);
      } else {
        setTextHitFound(false);
      }
    };
    const timer = window.setTimeout(tick, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    focusQuote,
    focusNonce,
    pageNumber,
    document.id,
    page?.markdown,
    paneSolo,
    sidePanel,
  ]);

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

  function stepVisible(delta: number) {
    const index = visiblePages.indexOf(pageRef.current);
    const fallback = delta > 0 ? visiblePages[0] : visiblePages[visiblePages.length - 1];
    const target = visiblePages[index + delta] ?? fallback;
    if (target) void goToPage(target);
  }

  const canPrevPage = visiblePages[0] !== pageNumber;
  const canNextPage = visiblePages[visiblePages.length - 1] !== pageNumber;

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

  function toggleDrawingFullscreen() {
    if (paneSolo === "pdf") {
      setPaneSolo(null);
      if (focusMode) onToggleFocus();
    } else {
      setPaneSolo("pdf");
      if (!focusMode) onToggleFocus();
    }
  }

  const textToolBtn =
    "rounded border px-2 py-0.5 text-[10px] font-semibold border-slate-300 bg-white text-slate-800 hover:bg-slate-50";
  const textToolBtnActive =
    "rounded border px-2 py-0.5 text-[10px] font-semibold border-accent/50 bg-accent/10 text-accent";

  const sheetToolButtons = (
    <>
      <button
        type="button"
        title={searchOpen ? "Закрыть поиск (Esc)" : "Поиск по файлу (/ или Ctrl+F)"}
        onClick={() => (searchOpen ? closeSearch() : openSearch())}
        className={searchOpen ? textToolBtnActive : textToolBtn}
      >
        {searchOpen ? "Закрыть поиск" : "Поиск"}
      </button>
      <button
        type="button"
        title={
          viewedSet.has(pageNumber)
            ? "Снять отметку «просмотрен» (V)"
            : "Отметить лист просмотренным (V)"
        }
        onClick={toggleViewed}
        className={viewedSet.has(pageNumber) ? textToolBtnActive : textToolBtn}
      >
        <span className="mr-1" aria-hidden>
          {viewedSet.has(pageNumber) ? "☑" : "☐"}
        </span>
        Просмотрен
      </button>
      <button
        type="button"
        title="Миниатюры листов"
        onClick={() => {
          setStripOpen((prev) => {
            const next = !prev;
            saveViewerPrefs({ ...loadViewerPrefs(), thumbs: next });
            return next;
          });
        }}
        className={stripOpen ? textToolBtnActive : textToolBtn}
      >
        Миниатюры
      </button>
      {readOnly ? (
        <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
          Просмотр
        </span>
      ) : null}
    </>
  );

  const pageNav = {
    onPrevPage: () => stepVisible(-1),
    onNextPage: () => stepVisible(1),
    canPrevPage,
    canNextPage,
    onToggleFullscreen: isOfficeSource ? undefined : toggleDrawingFullscreen,
    fullscreenActive: paneSolo === "pdf",
  };

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
        if (keymapOpen) {
          setKeymapOpen(false);
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

      // Дальше — одиночные клавиши: не перехватываем системные сочетания.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Сравниваем по event.code: работает и на русской раскладке.
      if (event.key === "?" || (event.code === "Slash" && event.shiftKey)) {
        event.preventDefault();
        setKeymapOpen((prev) => !prev);
        return;
      }
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

      if (fileReviews.length > 0 && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const index = Math.max(0, fileReviews.findIndex((item) => item.id === activeReviewId));
        const next =
          event.key === "ArrowDown"
            ? fileReviews[Math.min(fileReviews.length - 1, index + 1)]
            : fileReviews[Math.max(0, index - 1)];
        if (next) selectFileReview(next);
        return;
      }
      if (activeReviewId && projectId) {
        if (event.key === "1" || event.key === "2" || event.key === "3") {
          const severity: ReviewSeverity =
            event.key === "1" ? "low" : event.key === "2" ? "medium" : "high";
          void patchReview(activeReviewId, { severity });
          return;
        }
        if (event.key === "Enter") {
          void patchReview(activeReviewId, { verdict: "confirmed" });
          return;
        }
      }

      if (event.code === "KeyJ" || event.key === "PageDown") {
        event.preventDefault();
        stepVisible(1);
      }
      if (event.code === "KeyK" || event.key === "PageUp") {
        event.preventDefault();
        stepVisible(-1);
      }
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

  useEffect(() => {
    onPageLogReady?.({ open: () => setShowLog(true), count: pageLogs.length });
    return () => onPageLogReady?.(null);
  }, [onPageLogReady, pageLogs.length]);

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
            Нажмите «Отметить ошибку» и обведите место на чертеже
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
              onCollapse={() => {
                setStripOpen(false);
                saveViewerPrefs({ ...loadViewerPrefs(), thumbs: false });
              }}
            />
            <ColumnResizer
              onDelta={(dx) => setStripWidth((w) => clamp(w + dx, 72, 220))}
            />
          </>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1">
          {!stripOpen && !isOfficeSource ? (
            <button
              type="button"
              title="Показать миниатюры"
              aria-label="Показать миниатюры"
              onClick={() => {
                setStripOpen(true);
                saveViewerPrefs({ ...loadViewerPrefs(), thumbs: true });
              }}
              className="flex w-8 shrink-0 flex-col items-center border-r border-border bg-surface-2 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <IconChevronRight />
            </button>
          ) : null}
          {fileReviews.length > 0 && paneSolo !== "md" ? (
            railOpen ? (
            <RemarkRail
              items={fileReviews}
              activeId={activeReviewId}
              pageNumber={pageNumber}
              onSelect={selectFileReview}
              onCollapse={() => {
                setRailOpen(false);
                saveViewerPrefs({ ...loadViewerPrefs(), remarks: false });
              }}
            />
            ) : (
              <button
                type="button"
                title="Показать замечания"
                aria-label="Показать замечания"
                onClick={() => {
                  setRailOpen(true);
                  saveViewerPrefs({ ...loadViewerPrefs(), remarks: true });
                }}
                className="flex w-8 shrink-0 flex-col items-center gap-1 border-r border-border bg-white py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                <IconChevronRight />
                <span className="text-[10px] font-semibold tabular-nums">
                  {fileReviews.length}
                </span>
              </button>
            )
          ) : null}
          {paneSolo !== "md" ? (
            <div
              className="relative min-h-0 min-w-0"
              style={{ width: paneSolo === "pdf" ? "100%" : `${split}%` }}
            >
              {focusDrawing && textHitFound !== null ? (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center px-2 pt-1">
                  {drawingHitCount === 0 && textHitFound === false ? (
                    <span className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-950 shadow-sm">
                      Цитата не найдена на чертеже и в тексте
                    </span>
                  ) : drawingHitCount === 0 ? (
                    <span className="pointer-events-auto rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-[11px] text-rose-950 shadow-sm">
                      Цитата не найдена на чертеже.{" "}
                      <button
                        type="button"
                        className="font-semibold underline decoration-dotted"
                        onClick={() => {
                          setPaneSolo(null);
                          setSidePanel("text");
                          setFocusNonce(Date.now());
                        }}
                      >
                        Показать в тексте
                      </button>
                    </span>
                  ) : textHitFound === false ? (
                    <span className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-[11px] text-sky-950 shadow-sm">
                      Цитата на чертеже · в тексте не найдена
                    </span>
                  ) : null}
                </div>
              ) : null}
              {paneSolo === "pdf" ? (
                <div className="absolute left-2 top-12 z-30 flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-white/95 px-1.5 py-1 shadow-sm">
                  {sheetToolButtons}
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPaneSolo(null);
                        setSidePanel("notes");
                        setPendingRect(null);
                        setMarkMode(true);
                      }}
                      className={
                        markMode
                          ? "rounded border border-slate-700 bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-white"
                          : "rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-800 hover:bg-slate-50"
                      }
                    >
                      {markMode ? "Рисую ошибку…" : "Отметить ошибку"}
                    </button>
                  ) : null}
                </div>
              ) : null}
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
                  panToHighlight={false}
                  remarkFocus={focusDrawing}
                  highlightNonce={focusNonce}
                  onHighlightHits={handleHighlightHits}
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
                  panToHighlight={false}
                  remarkFocus={focusDrawing}
                  highlightNonce={focusNonce}
                  onHighlightHits={handleHighlightHits}
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
                  panToHighlight={false}
                  remarkFocus={focusDrawing}
                  highlightNonce={focusNonce}
                  onHighlightHits={handleHighlightHits}
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
                  panToHighlight={false}
                  remarkFocus={focusDrawing}
                  highlightNonce={focusNonce}
                  onHighlightHits={handleHighlightHits}
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

          {paneSolo === "pdf" ? (
            <button
              type="button"
              title="Показать текст"
              aria-label="Показать текст"
              onClick={() => setPaneSolo(null)}
              className="flex w-8 shrink-0 flex-col items-center border-l border-border bg-white py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <IconChevronLeft />
            </button>
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

          {paneSolo === "md" ? (
            <button
              type="button"
              title="Показать чертёж"
              aria-label="Показать чертёж"
              onClick={() => setPaneSolo(null)}
              className="flex w-8 shrink-0 flex-col items-center border-r border-border bg-white py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <IconChevronRight />
            </button>
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
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1">
              <PaneToggle
                expanded
                align="right"
                expandLabel="Показать текст"
                collapseLabel="Скрыть текст"
                onToggle={() => setPaneSolo("pdf")}
              />
              <button
                type="button"
                onClick={() => setSidePanel("text")}
                className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${
                  sidePanel === "text"
                    ? "border-slate-700 bg-slate-700 text-white"
                    : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                {page?.kind === "table" ? "Таблица" : "Текст листа"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSidePanel("notes");
                  if (!readOnly) {
                    setPendingRect(null);
                    setMarkMode(true);
                  }
                }}
                className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${
                  sidePanel === "notes" || markMode
                    ? "border-slate-700 bg-slate-700 text-white"
                    : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                {markMode ? "Рисую ошибку…" : "Отметить ошибку"}
                {!markMode && pageNotes.length ? (
                  <span className="ml-1 tabular-nums opacity-80">
                    {pageNotes.length}
                  </span>
                ) : null}
              </button>
              {sheetToolButtons}
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
              className="pto-pane-scroll min-h-0 flex-1 overflow-x-scroll overflow-y-auto [scrollbar-gutter:stable]"
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
                        <span className="ml-1 font-normal text-rose-700/80">
                          · кликните, чтобы подсветить на чертеже
                        </span>
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {pageReviews.map((review) => {
                          const active =
                            focusQuote.length >= 2 &&
                            (
                              review.locations.some(
                                (loc) =>
                                  loc.quote &&
                                  normalizeQuote(loc.quote) ===
                                    normalizeQuote(focusQuote),
                              ) ||
                              normalizeQuote(review.text || "") ===
                                normalizeQuote(focusQuote) ||
                              normalizeQuote(review.aiFinding || "") ===
                                normalizeQuote(focusQuote)
                            );
                          return (
                            <li key={review.id}>
                              <button
                                type="button"
                                onClick={() => focusReviewOnSheet(review)}
                                className={`w-full rounded px-1.5 py-1 text-left leading-snug hover:bg-rose-100/80 ${
                                  active
                                    ? "bg-rose-200/90 outline outline-2 outline-rose-500"
                                    : ""
                                }`}
                                title="Подсветить место на чертеже и в расшифровке"
                              >
                                <span className="font-medium tabular-nums">
                                  № {review.number}
                                </span>
                                {` · ${REVIEW_SEVERITY_LABEL[
                                  review.severity
                                ].toLowerCase()} · ${
                                  review.text || review.aiFinding
                                }`}
                              </button>
                            </li>
                          );
                        })}
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

      {keymapOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Клавиши"
          onClick={() => setKeymapOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Клавиши</div>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-text"
                onClick={() => setKeymapOpen(false)}
              >
                Закрыть
              </button>
            </div>
            {KEYMAP_GROUPS.map((group) => (
              <section key={group.id} className="mb-3">
                <div className="mb-1 text-xs font-medium text-text">{group.label}</div>
                <ul className="space-y-1 text-[11px] text-muted">
                  {KEYMAP.filter((item) => item.group === group.id).map((item) => (
                    <li key={item.keys} className="flex justify-between gap-3">
                      <kbd className="shrink-0 rounded border border-border bg-bg px-1 font-mono text-[10px] text-text">
                        {item.keys}
                      </kbd>
                      <span className="text-right">{item.action}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      ) : null}

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
