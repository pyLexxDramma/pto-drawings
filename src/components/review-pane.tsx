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
import { MarkdownView } from "@/components/markdown-view";
import { PageStrip } from "@/components/page-strip";
import { PdfPage } from "@/components/pdf-page";
import { SegmentedTabs } from "@/components/ui-chrome";
import { IconChevronLeft, IconChevronRight } from "@/components/tool-icons";
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
  preferHighlightQuery,
  remarkTermsInMarkdown,
} from "@/lib/highlight-text";
import { quoteBannerKind } from "@/lib/quote-banner";
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
  /** Вернуть true, если «Назад» закрыл поиск/пометку и не должен уходить с листа. */
  onConsumeBack?: (fn: (() => boolean) | null) => void;
  onSheetBackHint?: (label: string | null) => void;
  onAnnotationsChanged?: () => void;
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
    Boolean(doc.errorMessage?.startsWith("Отмена"))
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
  activeJobDocument = null,
  kitSibling = null,
  onFullProgressVisible,
  onCancel,
  onToggleFocus,
  onBackToProjects,
  onConsumeBack,
  onSheetBackHint,
  onAnnotationsChanged,
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
  const [split, setSplit] = useState(66);
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
  /** След переходов по листам: куда вернёт «Назад» над расшифровкой. */
  const pageTrailRef = useRef<number[]>([]);
  const [trailTop, setTrailTop] = useState<number | null>(null);
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
  const [drawingHitCount, setDrawingHitCount] = useState<number | null>(null);
  const [textHitFound, setTextHitFound] = useState<boolean | null>(null);
  const [quoteBannerOn, setQuoteBannerOn] = useState(true);
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
    setDrawingHitCount(null);
    setTextHitFound(null);
    // Замечание выбрано — список больше не нужен, отдаём место расшифровке.
    setPageReviewsOpen(false);
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
  const textHighlightQuery = drawingHighlightQuery;
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

  // Один ряд плашек над листом: счётчик поиска, места, легенда цветов.
  const placeBar =
    siblingLocations.length > 1 && activeReview ? (
      <span className="pointer-events-auto inline-flex max-w-full items-center gap-0.5 rounded border border-violet-300/30 bg-slate-900/55 px-1.5 py-[3px] text-[9px] font-medium leading-none text-violet-100 shadow-md backdrop-blur">
        <button
          type="button"
          className="rounded px-1 font-semibold hover:bg-white/15"
          title="Предыдущее место"
          onClick={() => {
            const from = siblingIndex >= 0 ? siblingIndex : 0;
            const next =
              siblingLocations[
                (from - 1 + siblingLocations.length) % siblingLocations.length
              ];
            focusLocation(next, activeReview.id);
          }}
        >
          ←
        </button>
        <span className="min-w-0 truncate tabular-nums">
          Место {Math.max(siblingIndex, 0) + 1} из {siblingLocations.length}
          {siblingLocations[siblingIndex]?.pageNumber
            ? ` · стр. ${siblingLocations[siblingIndex].pageNumber}`
            : ""}
        </span>
        <button
          type="button"
          className="rounded px-1 font-semibold hover:bg-white/15"
          title="Следующее место"
          onClick={() => {
            const from = siblingIndex >= 0 ? siblingIndex : 0;
            const next = siblingLocations[(from + 1) % siblingLocations.length];
            focusLocation(next, activeReview.id);
          }}
        >
          →
        </button>
      </span>
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
    setDrawingHitCount(null);
    setTextHitFound(null);
  }
  /**
   * Места замечания — чипсами в самой строке: стрелки «Место N из M» над листом
   * инженеры не замечали и второе место оставалось непросмотренным.
   */
  function renderPlaceChips(review: Review) {
    const places = review.locations.filter(
      (item) => item.documentId && item.pageNumber,
    );
    if (places.length < 2) return null;
    return (
      <span className="inline-flex shrink-0 items-center gap-0.5">
        <span className="text-rose-800/70">места:</span>
        {places.map((place, index) => {
          const here =
            place.documentId === document.id && place.pageNumber === pageNumber;
          const current = activeReviewId === review.id && index === siblingIndex;
          return (
            <button
              key={`${place.documentId}-${place.pageNumber}-${index}`}
              type="button"
              onClick={() => focusLocation(place, review.id)}
              title={`Место ${index + 1} из ${places.length} · стр. ${place.pageNumber}${
                here ? "" : " · другой лист или файл"
              }`}
              className={`rounded border px-1 py-[1px] font-semibold tabular-nums ${
                current
                  ? "border-violet-500 bg-violet-200 text-violet-950"
                  : "border-rose-300 bg-white text-rose-900 hover:bg-rose-100"
              }`}
            >
              {index + 1}
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
  }, [document.id, notesRefreshToken]);

  useEffect(() => {
    if (!openPage || openPage.documentId !== document.id) return;
    navigatedRef.current = true;
    // Переход из фида проекта: внешнее событие, поэтому состояние двигаем здесь.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    pushPageTrail(openPage.page);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRawPage(openPage.page);
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

  // textHitFound / плашку сбрасываем при смене цитаты. drawingHitCount
  // не трогаем: эффект родителя бежит после зрителя и затирал «найдено: N».
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
    // Таблицы читаются шире, чем чертёж: отдаём им больше правой панели.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (page?.kind === "table") setSplit(42);
  }, [page?.kind]);

  /**
   * Текст расшифровки не правится руками (решение Дархана 09.09): исправления
   * идут только через «Ошибка» — тогда у конвейера остаётся, чему учиться.
   */
  function pushPageTrail(next: number) {
    const from = pageRef.current;
    if (!from || from === next) return;
    pageTrailRef.current = [...pageTrailRef.current.slice(-19), from];
    setTrailTop(from);
  }

  function goToPage(next: number) {
    navigatedRef.current = true;
    pushPageTrail(next);
    setRawPage(next);
  }

  /** Разбираем выбранное замечание — «Назад» сначала снимает выбор. */
  const backStep: "remark" | "page" | "screen" =
    focusQuote.trim().length >= 2 || activeReviewId
      ? "remark"
      : trailTop
        ? "page"
        : "screen";

  function popTrail(): number | null {
    const trail = pageTrailRef.current;
    const previous = trail[trail.length - 1];
    if (previous === undefined) return null;
    pageTrailRef.current = trail.slice(0, -1);
    setTrailTop(pageTrailRef.current[pageTrailRef.current.length - 1] ?? null);
    return previous;
  }

  /**
   * Возврат над расшифровкой, по шагам: снять выбранное замечание → вернуться
   * на лист, с которого пришли → уйти на предыдущий экран. Так «Назад» не
   * выбрасывает к проектам сразу после разбора замечания.
   */
  function goBackInTrail() {
    if (backStep === "remark") {
      const previous = popTrail();
      if (previous !== null) {
        navigatedRef.current = true;
        setRawPage(previous);
      }
      setFocusQuote("");
      setFocusRect(null);
      setActiveReviewId(null);
      setDrawingHitCount(null);
      setTextHitFound(null);
      // Список замечаний листа остаётся свёрнутым — открыть можно кликом.
      setPageReviewsOpen(false);
      return;
    }
    const previous = popTrail();
    if (previous === null) {
      onBackToProjects();
      return;
    }
    navigatedRef.current = true;
    setRawPage(previous);
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

  const quoteMiss = quoteBannerKind({
    bannerOn: quoteBannerOn,
    focusDrawing,
    pageSource: page?.source,
    textHitFound,
    drawingHitCount,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1">
        {stripHost && !isOfficeSource
          ? createPortal(
              <PageStrip
                embedded
                url={`/api/documents/${document.id}/file`}
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
                <div className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center px-2">
                  <div
                    className={`pointer-events-auto inline-flex max-w-full items-start gap-2 rounded-md border px-2.5 py-1 text-[11px] shadow-sm ${
                      quoteMiss === "model-no-layer" || quoteMiss === "miss-both"
                        ? "border-amber-300 bg-amber-50 text-amber-950"
                        : quoteMiss === "miss-drawing"
                          ? "border-rose-300 bg-rose-50 text-rose-950"
                          : "border-sky-300 bg-sky-50 text-sky-950"
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
                          ? "rounded border border-slate-700 bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-white"
                          : "rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-800 hover:bg-slate-50"
                      }
                    >
                      {markMode ? "Отменить" : "Отметить ошибку"}
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
                  highlightRegion={focusHighlightRegion}
                  highlightRegions={extraHighlightRegions}
                  panToHighlight={focusDrawing}
                  remarkFocus={focusDrawing}
                  highlightNonce={focusNonce}
                  onHighlightHits={handleHighlightHits}
                  overlay={placeBar}
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
                  overlay={placeBar}
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
                  overlay={placeBar}
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
                  overlay={placeBar}
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
            <div className="flex flex-wrap items-center gap-1 border-b border-border px-1.5 py-0.5">
              {/* Слева — возврат туда, откуда пришли; свернуть текст ушло вправо. */}
              <button
                type="button"
                onClick={goBackInTrail}
                title={
                  backStep === "remark"
                    ? "Снять выбранное замечание и вернуться к списку замечаний листа"
                    : backStep === "page"
                      ? `Вернуться к листу ${trailTop} расшифровки`
                      : "Вернуться на предыдущую страницу"
                }
                className="shrink-0 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 hover:bg-amber-100"
              >
                {backStep === "remark"
                  ? "← К замечаниям листа"
                  : backStep === "page"
                    ? `← Лист ${trailTop}`
                    : "← Назад"}
              </button>
              <button
                type="button"
                title={markMode ? "Отменить разметку (Esc)" : "Обвести ошибку на чертеже"}
                onClick={toggleMark}
                className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${
                  sidePanel === "notes" || markMode
                    ? "border-slate-700 bg-slate-700 text-white"
                    : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                {markMode ? "Отменить" : "Отметить ошибку"}
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
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {sidePanel === "text" && page?.source === "model" ? (
                  <span
                    className="truncate text-[10px] text-orange-700"
                    title="Текстового слоя нет — содержимое прочитано по изображению; сверьте числа и марки с оригиналом"
                  >
                    По изображению · сверить
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPaneSolo("pdf")}
                  title="Скрыть расшифровку — на экране останется только чертёж"
                  className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Скрыть текст · только чертёж ›
                </button>
              </span>
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

            {pageReviews.length > 0 ? (
              <div className="shrink-0 border-b border-rose-200 bg-rose-50 text-[10px] leading-snug text-rose-950">
                <div className="flex items-center justify-between gap-2 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setPageReviewsOpen((prev) => !prev)}
                    className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium hover:text-rose-700"
                    title={
                      pageReviewsOpen
                        ? "Свернуть список замечаний"
                        : "Показать замечания листа"
                    }
                  >
                    <span className="shrink-0">
                      {pageReviewsOpen ? "▾" : "▸"}
                    </span>
                    <span className="shrink-0">
                      Замечаний по листу: {pageReviews.length}
                    </span>
                    <span className="min-w-0 truncate font-normal text-rose-800/70">
                      {pageReviewsOpen
                        ? "· клик по строке подсветит место"
                        : activePageReview
                          ? `· № ${activePageReview.number} ${
                              activePageReview.text ||
                              activePageReview.aiFinding ||
                              ""
                            }`
                          : "· нажмите, чтобы раскрыть список"}
                    </span>
                  </button>
                  {!pageReviewsOpen && activePageReview
                    ? renderPlaceChips(activePageReview)
                    : null}
                  {onOpenReviews ? (
                    <button
                      type="button"
                      onClick={onOpenReviews}
                      className="shrink-0 rounded border border-rose-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-rose-900 hover:bg-rose-100"
                    >
                      В таблице
                    </button>
                  ) : null}
                </div>
                {pageReviewsOpen ? (
                <ul className="max-h-40 overflow-auto border-t border-rose-200/80">
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
                      <li
                        key={review.id}
                        className={`flex w-full items-start gap-1 px-2 py-1 ${
                          active
                            ? "bg-rose-200 outline outline-1 outline-rose-500"
                            : "hover:bg-rose-100"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => focusReviewOnSheet(review)}
                          className="min-w-0 flex-1 text-left"
                          title="Подсветить место на чертеже и в расшифровке"
                        >
                          <span className="font-semibold tabular-nums">
                            № {review.number}
                          </span>
                          {` · ${REVIEW_SEVERITY_LABEL[
                            review.severity
                          ].toLowerCase()} · ${
                            review.text || review.aiFinding
                          }`}
                        </button>
                        {renderPlaceChips(review)}
                      </li>
                    );
                  })}
                </ul>
                ) : null}
              </div>
            ) : null}

            <div
              ref={textPaneRef}
              className="pto-pane-scroll min-h-0 flex-1 overflow-x-scroll overflow-y-auto overscroll-x-contain [scrollbar-gutter:stable]"
            >
              {filterEmpty ? (
                <div className="p-4 text-xs text-muted">
                  {filter === "flagged"
                    ? "Отметьте ошибку на чертеже — лист появится в этом списке."
                    : `Нет листов типа «${filterLabel}» в этом комплекте. Выберите «Все» или вкладку с ненулевым счётчиком.`}
                </div>
              ) : !page ? (
                <div className="p-4 text-xs text-muted">
                  {processing
                    ? `Текст появится по мере обработки. Готово ${readyCount} из ${total}.`
                    : pageError
                      ? `Лист не обработан: ${pageError}`
                      : "Для этого листа ещё нет текста."}
                </div>
              ) : (
                <div
                  className={`markdown-body markdown-body--compact p-3 ${page.kind === "table" ? "markdown-body--table" : ""}`}
                >
                  {pageError ? (
                    <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-800">
                      Ошибка листа: {pageError}
                    </div>
                  ) : null}
                  {showTech && isMockPage ? (
                    <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950">
                      Это ответ режима [MOCK], не работа модели.
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
