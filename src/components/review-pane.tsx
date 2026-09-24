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
import { createPortal } from "react-dom";
import { ColumnResizer, clamp } from "@/components/column-resizer";
import { CadPage } from "@/components/cad-page";
import { PageReviewsBar } from "@/components/page-reviews-bar";
import { PageStrip } from "@/components/page-strip";
import { PdfPage } from "@/components/pdf-page";
import { SheetTextPane } from "@/components/sheet-text-pane";
import { SheetToolbar } from "@/components/sheet-toolbar";
import type { RemarkUndo } from "@/lib/remark-undo";
import { PaneToggle, SegmentedTabs } from "@/components/ui-chrome";
import { modelIssueCount } from "@/components/model-check-panel";
import {
  IconChevronLeft,
  IconChevronRight,
} from "@/components/tool-icons";
import type { ModelCheckInput } from "@/lib/model-check";
import { KEYMAP, KEYMAP_GROUPS } from "@/lib/keymap";
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
import {
  findQuoteRanges,
  preferHighlightQuery,
  remarkTermsInMarkdown,
} from "@/lib/highlight-text";
import { quoteBannerKind } from "@/lib/quote-banner";
import { placeOrdinal, sheetLabel } from "@/lib/sheet-label";
import {
  SPLIT_MAX,
  SPLIT_MIN,
  clampPaneSplit,
  loadViewerPrefs,
  saveSplit,
} from "@/lib/viewer-prefs";
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
  /** Сверка модели текущего листа — вкладка журналов «Агент ИИ (ошибки)». */
  onModelCheckChange?: (state: {
    count: number;
    input: ModelCheckInput;
  } | null) => void;
  /** Файл с активной обработкой в проекте (может отличаться от открытого). */
  activeJobDocument?: DocumentRecord | null;
  /** Связанный PDF или DWG из комплекта kitId. */
  kitSibling?: DocumentRecord | null;
  /** Сообщить workspace: развёрнутая панель прогресса занимает правую колонку. */
  onFullProgressVisible?: (visible: boolean) => void;
  onCancel?: () => void;
  onToggleFocus: () => void;
  onBackToProjects: () => void;
  /** Вернуть true, если «Назад» закрыл поиск/пометку и не должен уходить с листа. */
  onConsumeBack?: (fn: (() => boolean) | null) => void;
  onSheetBackHint?: (label: string | null) => void;
  onAnnotationsChanged?: (added?: Review) => void;
  /** Запомнить последнее добавление или удаление замечания для «Отменить». */
  onRemarkRecorded?: (action: RemarkUndo) => void;
  onUndoRemark?: () => void;
  canUndoRemark?: boolean;
  undoBusy?: boolean;
  notesRefreshToken?: number;
  /** Те же строки, что в «Замечаний по листу» — открыть таблицу по этому файлу. */
  onOpenReviews?: () => void;
  /** Другой файл того же замечания — из «место 2 из 3». */
  onJumpToPage?: (
    documentId: string,
    pageNumber: number,
    options?: { reviewId?: string; quote?: string },
  ) => void;
  /** Миниатюры листов в колонке проектов — сворачиваются вместе с ней. */
  stripHost?: HTMLElement | null;
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
    Boolean(
      doc.errorMessage?.startsWith("Отмена") ||
        doc.errorMessage?.startsWith("Обработка отменена"),
    )
  );
}

function sameRect(a?: AnnotationRect | null, b?: AnnotationRect | null) {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
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
  onModelCheckChange,
  activeJobDocument = null,
  kitSibling = null,
  onFullProgressVisible,
  onCancel,
  onToggleFocus,
  onBackToProjects,
  onConsumeBack,
  onSheetBackHint,
  onAnnotationsChanged,
  onRemarkRecorded,
  onUndoRemark,
  canUndoRemark = false,
  undoBusy = false,
  notesRefreshToken = 0,
  onOpenReviews,
  onJumpToPage,
  stripHost = null,
}: ReviewPaneProps) {
  const [rawPage, setRawPage] = useState(() => {
    const cached = getDocumentView(document.id);
    if (cached?.pageNumber && cached.pageNumber > 0) return cached.pageNumber;
    return loadCachedProgress(document.id).lastPage;
  });
  const [split, setSplit] = useState(() =>
    clampPaneSplit(
      loadViewerPrefs().splitDrawing,
      typeof window === "undefined" ? 1920 : window.innerWidth,
    ),
  );
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
  /** Клик по листу в полоске / прогрессе — показать чертёж, не панель обработки. */
  const [sheetPeek, setSheetPeek] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef(rawPage);
  const navigatedRef = useRef(false);
  const textPaneRef = useRef<HTMLDivElement>(null);
  const deferredQuery = useDeferredValue(query);
  /** Цитата из «Где в ПД»: подсветка в тексте и на чертеже. */
  const [focusQuote, setFocusQuote] = useState("");
  const [focusRect, setFocusRect] = useState<AnnotationRect | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  /** Список замечаний листа держим свёрнутым: он закрывал расшифровку. */
  const [pageReviewsOpen, setPageReviewsOpen] = useState(false);
  const [keymapOpen, setKeymapOpen] = useState(false);
  const [drawingReport, setDrawingReport] = useState<{
    nonce: number;
    count: number;
  } | null>(null);
  const [textHitFound, setTextHitFound] = useState<boolean | null>(null);
  const [quoteBannerOn, setQuoteBannerOn] = useState(true);
  const handleHighlightHits = useCallback((count: number, nonce: number) => {
    setDrawingReport({ nonce, count });
  }, []);
  const drawingHitCount =
    drawingReport && drawingReport.nonce === focusNonce
      ? drawingReport.count
      : null;

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
  const cancelPending = Boolean(
    document.errorMessage?.startsWith("Отмена") ||
      document.errorMessage?.startsWith("Обработка отменена"),
  );
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
  // На миниатюре — сколько замечаний на листе, цвет по разбору: важность у них
  // разная, и одна точка «средняя» вводила в заблуждение (созвон 18.09).
  const pageDots = useMemo(() => {
    const strength: Review["verdict"][] = [
      "pending",
      "wrong",
      "discuss",
      "partial",
      "confirmed",
      "outdated",
    ];
    const map = new Map<number, { count: number; verdict: Review["verdict"] }>();
    for (const review of fileReviews) {
      const pages = new Set<number>();
      for (const loc of review.locations) {
        if (loc.documentId !== document.id || !loc.pageNumber) continue;
        pages.add(loc.pageNumber);
      }
      for (const pageNumber of pages) {
        const prev = map.get(pageNumber);
        const worse =
          !prev ||
          strength.indexOf(review.verdict) < strength.indexOf(prev.verdict);
        map.set(pageNumber, {
          count: (prev?.count ?? 0) + 1,
          verdict: worse ? review.verdict : prev.verdict,
        });
      }
    }
    return map;
  }, [document.id, fileReviews]);
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
    if (quote.length < 2 && !location?.rect) return;
    setActiveReviewId(review.id);
    setFocusQuote(quote);
    setFocusRect(location?.rect ?? null);
    setFocusNonce(Date.now());
    setPaneSolo(null);
    setSidePanel("text");
    setDrawingReport(null);
    setTextHitFound(null);
  }
  function selectFileReview(review: Review) {
    const location =
      review.locations.find((item) => item.documentId === document.id) ??
      review.locations[0];
    if (location?.pageNumber) goToPage(location.pageNumber);
    focusReviewOnSheet(review);
  }

  /**
   * Жёлтым — места листа. Пока замечание не выбрано, показываем все; после
   * клика — только цитаты выбранного, иначе лист пестрит и непонятно, к чему
   * относится замечание (созвон 18.09). Слова из формулировки не берём: они
   * красили пол-листа.
   */
  const pageReviewQuotes = useMemo(() => {
    const picked = pageReviews.filter((review) => review.id === activeReviewId);
    const focused = picked.length > 0;
    const list = focused ? picked : pageReviews;
    return remarkTermsInMarkdown(
      page?.markdown ?? "",
      list.map((review) => ({
        quotes: review.locations
          .filter(
            (location) =>
              location.documentId === document.id &&
              location.pageNumber === pageNumber,
          )
          .map((location) => location.quote),
      })),
      focused ? [] : (page?.numbers?.suspect ?? []),
    );
  }, [
    activeReviewId,
    document.id,
    page?.markdown,
    page?.numbers?.suspect,
    pageNumber,
    pageReviews,
  ]);
  /** На чертеже и в расшифровке сначала шифр/число, иначе цитата. */
  const drawingHighlightQuery = (() => {
    const raw =
      focusQuote.trim().length >= 2 ? focusQuote.trim() : deferredQuery.trim();
    return preferHighlightQuery(raw, page?.markdown ?? "");
  })();
  /**
   * В расшифровке подсвечиваем фразу целиком, если она там есть. На чертеже
   * цитату приходится сужать до шифра — текстовый слой разбит на куски, — а в
   * тексте у находок со сканов цитата и есть предложение из описания модели,
   * и подсветка одного числа из него ничего инженеру не говорит (0094).
   */
  const textHighlightQuery = (() => {
    const raw =
      focusQuote.trim().length >= 2 ? focusQuote.trim() : deferredQuery.trim();
    if (raw.length >= 2 && findQuoteRanges(page?.markdown ?? "", raw).length > 0) {
      return raw;
    }
    return drawingHighlightQuery;
  })();
  const focusDrawing = focusQuote.trim().length >= 2 || Boolean(focusRect);
  // Ссылка должна быть стабильной: зритель фильтрует по ней совпадения поиска.
  const focusHighlightRegion = useMemo(
    () =>
      focusRect ? { id: "review-focus", text: focusQuote, ...focusRect } : null,
    [focusRect, focusQuote],
  );
  const activeReview = useMemo(
    () => reviews.find((item) => item.id === activeReviewId) ?? null,
    [reviews, activeReviewId],
  );
  /** Выбранное замечание этого листа — для свёрнутой шапки списка. */
  const activePageReview =
    pageReviews.find((item) => item.id === activeReviewId) ?? null;
  const siblingLocations = useMemo(
    () =>
      (activeReview?.locations ?? []).filter(
        (item) => item.documentId && item.pageNumber,
      ),
    [activeReview],
  );
  const siblingIndex = useMemo(() => {
    if (siblingLocations.length === 0) return -1;
    const quote = normalizeQuote(focusQuote);
    const exact = siblingLocations.findIndex(
      (item) =>
        item.documentId === document.id &&
        item.pageNumber === pageNumber &&
        (!quote || normalizeQuote(item.quote) === quote),
    );
    if (exact >= 0) return exact;
    return siblingLocations.findIndex(
      (item) =>
        item.documentId === document.id && item.pageNumber === pageNumber,
    );
  }, [siblingLocations, document.id, pageNumber, focusQuote]);
  const extraHighlightRegions = useMemo(
    () =>
      siblingLocations
        .filter(
          (item) =>
            item.documentId === document.id &&
            item.pageNumber === pageNumber &&
            item.rect &&
            !sameRect(item.rect, focusRect),
        )
        .map((item, index) => ({
          id: `review-sib-${index}`,
          text: item.quote,
          ...item.rect!,
        })),
    [siblingLocations, document.id, pageNumber, focusRect],
  );

  // Переключатель источника листа едет внутрь тулбара вьюера: отдельной плашкой
  // он был четвёртым независимым слоем поверх чертежа.
  const kitSwitch = hasKitDrawing ? (
    <SegmentedTabs
      size="xs"
      tone="onDark"
      value={kitDrawingView}
      onChange={(value) => setKitDrawingView(value as "pdf" | "cad")}
      options={[
        { id: "pdf", label: "PDF" },
        { id: "cad", label: "DWG" },
      ]}
    />
  ) : null;

  function focusLocation(
    location: (typeof siblingLocations)[number],
    reviewId: string,
  ) {
    const quote = (location.quote || focusQuote || "").trim();
    if (location.documentId && location.documentId !== document.id) {
      onJumpToPage?.(location.documentId, location.pageNumber!, {
        reviewId,
        quote: quote || undefined,
      });
      return;
    }
    if (location.pageNumber) goToPage(location.pageNumber);
    setActiveReviewId(reviewId);
    setFocusQuote(quote);
    setFocusRect(location.rect ?? null);
    setFocusNonce(Date.now());
    setPaneSolo(null);
    setSidePanel("text");
    setDrawingReport(null);
    setTextHitFound(null);
  }
  /**
   * Места замечания — чипсами в самой строке замечания.
   */
  function renderPlaceChips(review: Review) {
    const places = review.locations.filter(
      (item) => item.documentId && item.pageNumber,
    );
    if (places.length < 2) return null;
    return (
      <span className="inline-flex shrink-0 items-center gap-0.5">
        {places.map((place, index) => {
          const here =
            place.documentId === document.id && place.pageNumber === pageNumber;
          const current = activeReviewId === review.id && index === siblingIndex;
          const label = placeOrdinal(index);
          return (
            <button
              key={`${place.documentId}-${place.pageNumber}-${index}`}
              type="button"
              onClick={() => focusLocation(place, review.id)}
              title={`${label} · ${
                sheetLabel(place) ?? "лист не указан"
              }${here ? "" : " · другой лист или файл"}`}
              className={`whitespace-nowrap rounded border px-1 py-[1px] font-semibold ${
                current
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-white text-muted hover:border-accent hover:text-accent"
              }`}
            >
              {label}
            </button>
          );
        })}
      </span>
    );
  }
  const activeNoteId = hoverNoteId;
  const viewingProcessedSheet =
    progressIsCurrentDoc &&
    progressLive &&
    (sheetPeek ||
      (ready.has(pageNumber) && pageNumber !== activeProcessingPage));
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
  }, [document.id, notesRefreshToken]);

  useEffect(() => {
    if (!openPage || openPage.documentId !== document.id) return;
    navigatedRef.current = true;
    // Переход из фида проекта: внешнее событие, поэтому состояние двигаем здесь.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRawPage(openPage.page);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSheetPeek(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgressExpanded(false);
    const quote = (openPage.quote ?? "").trim();
    setFocusQuote(quote);
    if (!openPage.reviewId) setFocusRect(null);
    if (openPage.reviewId) setActiveReviewId(openPage.reviewId);
    if (quote || openPage.reviewId) {
      setFocusNonce(Date.now());
      setPaneSolo(null);
      setSidePanel("text");
    }
  }, [document.id, openPage]);

  // textHitFound сбрасываем при смене цитаты. Ответ чертежа привязан к
  // focusNonce: старый ноль не зажигает плашку, новый ответ не затирается.
  useEffect(() => {
    setTextHitFound(null);
    setQuoteBannerOn(true);
  }, [focusQuote, focusNonce, document.id, pageNumber]);

  // Цитата из reviewId, если workspace ещё не дописал quote в openPage.
  useEffect(() => {
    const reviewId = openPage?.reviewId;
    if (!reviewId || openPage.documentId !== document.id) return;
    const review = reviews.find((item) => item.id === reviewId);
    if (!review) return;
    const onPage = review.locations.filter(
      (item) =>
        item.documentId === document.id &&
        item.pageNumber === (openPage.page || pageNumber),
    );
    const wanted = normalizeQuote(focusQuote);
    const location =
      (wanted.length >= 2
        ? onPage.find((item) => normalizeQuote(item.quote) === wanted)
        : undefined) ??
      onPage[0] ??
      review.locations.find((item) => item.documentId === document.id) ??
      review.locations[0];
    const quote = location?.quote?.trim() ?? "";
    if (quote.length < 2 && !location?.rect) return;
    // Ссылка из разбора приносит цитату, но не рамку. Без неё своё место
    // уходило в «другие места» синим, а зелёного не было вовсе.
    if (focusQuote.trim().length >= 2) {
      if (!focusRect && location?.rect) setFocusRect(location.rect);
      return;
    }
    setFocusQuote(quote);
    setFocusRect(location?.rect ?? null);
    setFocusNonce(Date.now());
    setPaneSolo(null);
    setSidePanel("text");
  }, [focusQuote, focusRect, openPage, reviews, document.id, pageNumber]);

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
    // Таблицы читаются шире, чем чертёж: отдаём им больше правой панели. Обе
    // доли берём из настроек — раздвинутую границу инженер теряет иначе.
    const prefs = loadViewerPrefs();
    const width = window.innerWidth;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSplit(
      clampPaneSplit(
        page?.kind === "table" ? prefs.splitTable : prefs.splitDrawing,
        width,
        page?.kind === "table" ? "table" : "drawing",
      ),
    );
  }, [page?.kind]);

  function goToPage(next: number) {
    navigatedRef.current = true;
    setRawPage(next);
    setSheetPeek(true);
    setProgressExpanded(false);
    setPaneSolo(null);
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

  function cancelMark() {
    setMarkMode(false);
    setPendingRect(null);
    setNoteComment("");
    setNoteExpected("");
    setNoteError(null);
    setSidePanel("text");
  }

  useEffect(() => {
    if (searchOpen) {
      onSheetBackHint?.("← Закрыть поиск");
    } else if (markMode || pendingRect) {
      onSheetBackHint?.("← Отменить пометку");
    } else {
      onSheetBackHint?.(null);
    }
    return () => onSheetBackHint?.(null);
  }, [markMode, onSheetBackHint, pendingRect, searchOpen]);

  useEffect(() => {
    if (!onConsumeBack) return;
    onConsumeBack(() => {
      if (searchOpen) {
        closeSearch();
        return true;
      }
      if (markMode || pendingRect) {
        cancelMark();
        return true;
      }
      return false;
    });
    return () => onConsumeBack(null);
  }, [markMode, onConsumeBack, pendingRect, searchOpen]);

  function toggleMark() {
    if (readOnly) return;
    if (markMode) {
      setMarkMode(false);
      setPendingRect(null);
      setNoteComment("");
      setNoteExpected("");
      setNoteError(null);
      setSidePanel("text");
      return;
    }
    setPendingRect(null);
    setMarkMode(true);
    setSidePanel("notes");
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

  const backLabel = markMode || pendingRect
    ? "← Отменить пометку"
    : searchOpen
      ? "← Закрыть поиск"
      : "← Назад";
  const sheetToolButtons = (
    <SheetToolbar
      searchOpen={searchOpen}
      readOnly={readOnly}
      onOpenSearch={openSearch}
      onCloseSearch={closeSearch}
      onBack={onBackToProjects}
      backLabel={backLabel}
      onUndo={canUndoRemark ? onUndoRemark : undefined}
      undoBusy={undoBusy}
    />
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
          cancelMark();
          return;
        }
        if (paneSolo || focusMode) {
          event.preventDefault();
          setPaneSolo(null);
          if (focusMode) onToggleFocus();
          return;
        }
        onBackToProjects();
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
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
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
    let last = split;
    const move = (moveEvent: globalThis.MouseEvent) => {
      const rect = parent.getBoundingClientRect();
      const next = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      last = clamp(next, SPLIT_MIN, SPLIT_MAX);
      setSplit(last);
    };
    const up = () => {
      window.document.body.style.cursor = prevCursor;
      window.document.body.style.userSelect = prevSelect;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      // Помним по типу листа: у ведомости и чертежа удобная ширина разная.
      saveSplit(page?.kind === "table" ? "table" : "drawing", last);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
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
      review?: Review;
      error?: string;
    };
    if (!payload.annotation) {
      setNoteError(payload.error ?? "Не удалось сохранить замечание");
      return;
    }
    onRemarkRecorded?.({
      kind: "add",
      documentId: document.id,
      annotationId: payload.annotation.id,
      pageNumber,
      rect: pendingRect,
      comment,
      expected: noteExpected.trim(),
    });
    setNotes((prev) => [payload.annotation!, ...prev]);
    setPendingRect(null);
    setMarkMode(false);
    setNoteComment("");
    setNoteExpected("");
    onAnnotationsChanged?.(payload.review);
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
    onRemarkRecorded?.({
      kind: "delete",
      documentId: document.id,
      pageNumber: note.pageNumber,
      rect: note.rect,
      comment: note.comment,
      expected: note.expected,
    });
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
  const modelCheckInput = useMemo(
    () => ({
      pageNumber,
      source: page?.source,
      warnings: page?.warnings ?? [],
      pageWarning,
      pageError,
      numbers: page?.numbers,
      reviewCount: pageReviews.length,
    }),
    [
      pageNumber,
      page?.source,
      page?.warnings,
      pageWarning,
      pageError,
      page?.numbers,
      pageReviews.length,
    ],
  );
  const modelIssues = modelIssueCount(modelCheckInput);

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

  useEffect(() => {
    onModelCheckChange?.({ count: modelIssues, input: modelCheckInput });
  }, [modelIssues, modelCheckInput, onModelCheckChange]);

  useEffect(() => {
    return () => onModelCheckChange?.(null);
  }, [onModelCheckChange]);

  const notesPanel = (
    <div className="flex min-h-0 flex-1 flex-col">
      {pendingRect ? (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-3 py-2">
          <div className="pto-t-md font-medium text-red-700">Новое замечание</div>
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
                className="rounded-full border border-red-200 bg-white px-2 py-0.5 pto-t-sm text-red-800 hover:bg-red-100"
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
            <div className="mt-1 pto-t-md text-red-700">{noteError}</div>
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
              onClick={toggleMark}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-3">
        {pageNotes.length === 0 ? (
          pendingRect ? null : (
          <div className="rounded-md border border-dashed border-slate-300 bg-[#fafbfc] px-3 py-8 text-center pto-t-lg leading-relaxed text-muted">
            Нажмите «Отметить ошибку» и обведите место на чертеже
          </div>
          )
        ) : (
          pageNotes.map((note, index) => (
            <div
              key={note.id}
              onMouseEnter={() => setHoverNoteId(note.id)}
              onMouseLeave={() => setHoverNoteId(null)}
              className={`rounded-md border px-2.5 py-2 pto-t-md ${
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
              <div className="mt-0.5 pto-t-sm text-muted">
                {note.userName ? `${note.userName} · ` : ""}
                {formatDate(note.createdAt)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const quoteMiss = quoteBannerKind({
    bannerOn: quoteBannerOn,
    focusDrawing,
    pageSource: page?.source,
    textHitFound,
    drawingHitCount,
    highlighted: Boolean(focusRect) || (drawingHitCount ?? 0) > 0,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1">
        {stripHost && !isOfficeSource
          ? createPortal(
              <PageStrip
                embedded
                total={total}
                current={pageNumber}
                kinds={kinds}
                edited={editedPages}
                viewed={viewedSet}
                pageDots={pageDots}
                ready={ready}
                annotated={annotatedPages}
                hidden={hidden}
                processingPage={document.processingPage}
                emptyLabel={
                  filter === "flagged"
                    ? "Замечаний по этому файлу пока нет."
                    : `Листов типа «${filterLabel}» в комплекте нет.`
                }
                onSelect={(next) => void goToPage(next)}
              />,
              stripHost,
            )
          : null}

        <div className="flex min-h-0 min-w-0 flex-1">
          {paneSolo !== "md" ? (
            <div
              className="relative h-full min-h-0 min-w-0 overflow-hidden"
              style={{ width: paneSolo === "pdf" ? "100%" : `${split}%` }}
            >
              {quoteMiss ? (
                // Выше строки состояния: на её уровне плашка обрезалась, и
                // кнопка «Показать в тексте» уезжала под подсказку про мышь.
                <div className="pointer-events-none absolute inset-x-0 bottom-11 z-20 flex justify-center px-2">
                  <div
                    className={`pointer-events-auto inline-flex max-w-full items-start gap-2 rounded-md border px-2.5 py-1 pto-t-md shadow-sm ${
                      quoteMiss === "model-no-layer" || quoteMiss === "miss-both"
                        ? "border-sem-attn-line bg-sem-attn-soft text-amber-950"
                        : quoteMiss === "miss-drawing"
                          ? "border-sem-issue-line bg-sem-issue-soft text-rose-950"
                          : "border-border bg-surface-2 text-text"
                    }`}
                  >
                    <span className="min-w-0">
                      {quoteMiss === "model-no-layer" ? (
                        <>
                          На листе нет текстового слоя — на чертеже подсветить
                          нечего.
                          {textHitFound === true ? (
                            <>
                              {" "}
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
                            </>
                          ) : textHitFound === false ? (
                            " В расшифровке точного совпадения тоже нет."
                          ) : null}
                        </>
                      ) : quoteMiss === "miss-both" ? (
                        "Цитата не найдена на чертеже и в тексте"
                      ) : quoteMiss === "miss-drawing" ? (
                        <>
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
                        </>
                      ) : (
                        "Цитата на чертеже · в тексте не найдена"
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuoteBannerOn(false)}
                      className="shrink-0 rounded px-1 leading-none opacity-70 hover:bg-black/5 hover:opacity-100"
                      title="Закрыть"
                      aria-label="Закрыть"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ) : null}
              {paneSolo === "pdf" ? (
                <div className="absolute left-2 top-12 z-30 flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-white/95 px-1.5 py-1 shadow-sm">
                  {sheetToolButtons}
                  {!readOnly ? (
                    <button
                      type="button"
                      title={markMode ? "Отменить разметку (Esc)" : "Обвести ошибку на чертеже"}
                      onClick={() => {
                        if (markMode) {
                          toggleMark();
                          return;
                        }
                        setPaneSolo(null);
                        toggleMark();
                      }}
                      className={
                        markMode
                          ? "rounded border border-slate-700 bg-slate-700 px-2 py-0.5 pto-t-sm font-semibold text-white"
                          : "rounded border border-accent bg-accent px-2 py-0.5 pto-t-sm font-semibold text-white shadow-sm hover:bg-[#1d4ed8]"
                      }
                    >
                      Отметить ошибку
                    </button>
                  ) : null}
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
                  highlightRegion={focusHighlightRegion}
                  highlightRegions={extraHighlightRegions}
                  panToHighlight={focusDrawing}
                  remarkFocus={focusDrawing}
                  highlightNonce={focusNonce}
                  onHighlightHits={handleHighlightHits}
                  toolbarLeading={kitSwitch}
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
                  highlightRegion={focusHighlightRegion}
                  highlightRegions={extraHighlightRegions}
                  panToHighlight={focusDrawing}
                  remarkFocus={focusDrawing}
                  highlightNonce={focusNonce}
                  onHighlightHits={handleHighlightHits}
                  toolbarLeading={kitSwitch}
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
                  highlightRegion={focusHighlightRegion}
                  highlightRegions={extraHighlightRegions}
                  panToHighlight={focusDrawing}
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
                  highlightRegion={focusHighlightRegion}
                  highlightRegions={extraHighlightRegions}
                  panToHighlight={focusDrawing}
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
              data-split-handle=""
              title="Потяните, чтобы изменить ширину чертежа и расшифровки — ширина запомнится"
              onMouseDown={startSplit}
              // Заметная на глаз полоса: раньше границу в 1px никто не находил
              // и читал расшифровку в узкой колонке (баг 0098).
              className="group/split relative z-10 w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-accent/60"
            >
              <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
              <span className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-400 group-hover/split:bg-accent" />
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
                currentPage={pageNumber}
                onOpenPage={(page) => goToPage(page)}
                onCollapse={
                  viewingProcessedSheet
                    ? () => setProgressExpanded(false)
                    : undefined
                }
              />
            ) : (
              <>
            <div className="flex flex-wrap items-center gap-1 border-b border-border px-1.5 py-0.5">
              <button
                type="button"
                title={markMode ? "Отменить разметку (Esc)" : "Обвести ошибку на чертеже"}
                onClick={toggleMark}
                className={`rounded border px-2 py-0.5 pto-t-sm font-semibold ${
                  sidePanel === "notes" || markMode
                    ? "border-slate-700 bg-slate-700 text-white"
                    : "border-accent bg-accent text-white shadow-sm hover:bg-[#1d4ed8]"
                }`}
              >
                Отметить ошибку
                {!markMode && pageNotes.length ? (
                  <span className="ml-1 tabular-nums opacity-80">
                    {pageNotes.length}
                  </span>
                ) : null}
              </button>
              {sheetToolButtons}
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <PaneToggle
                  expanded
                  align="right"
                  expandLabel="Показать текст"
                  collapseLabel="Скрыть расшифровку — останется только чертёж"
                  onToggle={() => setPaneSolo("pdf")}
                />
              </span>
            </div>

            {sidePanel === "notes" ? (
              notesPanel
            ) : (
              <>

            <SheetTextPane
              paneRef={textPaneRef}
              searchRef={searchRef}
              searchOpen={searchOpen}
              query={query}
              hits={hits}
              onQueryChange={setQuery}
              onCloseSearch={closeSearch}
              onGoToPage={(target) => void goToPage(target)}
              page={page}
              pageError={pageError}
              filterEmpty={filterEmpty}
              filterEmptyText={
                filter === "flagged"
                  ? "Отметьте ошибку на чертеже — лист появится в этом списке."
                  : `Нет листов типа «${filterLabel}» в этом комплекте. Выберите «Все» или вкладку с ненулевым счётчиком.`
              }
              emptyPageText={
                processing
                  ? `Текст появится по мере обработки. Готово ${readyCount} из ${total}.`
                  : pageError
                    ? `Лист не обработан: ${pageError}`
                    : "Для этого листа ещё нет текста."
              }
              mockNotice={Boolean(showTech && isMockPage)}
              highlightQuery={textHighlightQuery}
              focusFirst={focusDrawing}
              flagQuotes={pageReviewQuotes}
              reviewsBar={
                <PageReviewsBar
                  reviews={pageReviews}
                  open={pageReviewsOpen}
                  focusQuote={focusQuote}
                  activeReview={activePageReview}
                  renderPlaceChips={renderPlaceChips}
                  onToggle={() => setPageReviewsOpen((prev) => !prev)}
                  onFocusReview={focusReviewOnSheet}
                  onOpenReviews={onOpenReviews}
                />
              }
            />

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
                <ul className="space-y-1 pto-t-md text-muted">
                  {KEYMAP.filter((item) => item.group === group.id).map((item) => (
                    <li key={item.keys} className="flex justify-between gap-3">
                      <kbd className="shrink-0 rounded border border-border bg-bg px-1 font-mono pto-t-sm text-text">
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
                    className="rounded-md bg-surface-2 px-2 py-1.5 pto-t-md text-muted"
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
