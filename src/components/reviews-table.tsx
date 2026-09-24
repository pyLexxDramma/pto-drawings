"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ExcelColFilter } from "@/components/excel-col-filter";
import { ResolvedSummary } from "@/components/resolved-summary";
import { Tooltip } from "@/components/tooltip";
import { Spinner, VerdictDot } from "@/components/ui-chrome";
import { IconDoc, IconDownload } from "@/components/tool-icons";
import {
  applyExcelFilters,
  excelColValues,
  excelUniqueValues,
  type ExcelCol,
  type ExcelColFilters,
} from "@/lib/excel-filter";
import {
  SEVERITY_CHIP,
  SEVERITY_ROW,
  VERDICT_CHIP,
  severityCellFrame,
} from "@/lib/review-colors";
import { formatDate } from "@/lib/format";
import { placeOrdinal, remarkWording, sheetLabel } from "@/lib/sheet-label";
import { isCrossSection, knownSectionRank } from "@/lib/sections";
import {
  REVIEW_EVENT_LABEL,
  reviewAuthor,
  REVIEW_SEVERITY_LABEL,
  REVIEW_SEVERITY_ORDER,
  REVIEW_VERDICT_LABEL,
  isExportableReview,
  type Review,
  type ReviewEvent,
  type ReviewLocation,
  type ReviewOrigin,
  type ReviewSeverity,
  type ReviewVerdict,
} from "@/types";

const VERDICTS: ReviewVerdict[] = [
  "pending",
  "confirmed",
  "partial",
  "discuss",
  "outdated",
  "wrong",
];

/**
 * Готовые причины брака: инженеру на разборе некогда печатать, а конвейер
 * без формулировки «что не так» не починить.
 */
const WRONG_TAGS = [
  "Такого в чертеже нет",
  "Не то место в ПД",
  "Числа сходятся",
  "Дубль другого замечания",
  "Формулировка мимо",
  "Не наша зона ответственности",
];

/**
 * Кто нашёл замечание — третья ось, и цвета она не получает: ИИ / Инженер /
 * Совпало написано на чипе словами. Иначе на строку приходится три хюа и ни
 * один не читается. Различаем заливкой по насыщенности нейтрали.
 */
const ORIGIN_CHIP: Record<ReviewOrigin, string> = {
  ai: "border-slate-300 bg-slate-100 text-slate-700",
  engineer: "border-slate-300 bg-white text-muted",
  both: "border-accent/40 bg-accent/5 text-accent",
};

/**
 * Поиск не только отсеивает строки, но и показывает, где именно совпало:
 * иначе в длинной формулировке приходится искать слово глазами.
 */
function highlight(text: string, needle: string) {
  if (!needle) return text;
  const lower = text.toLowerCase();
  const parts: (string | { match: string })[] = [];
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at < 0) break;
    if (at > from) parts.push(text.slice(from, at));
    parts.push({ match: text.slice(at, at + needle.length) });
    from = at + needle.length;
  }
  if (parts.length === 0) return text;
  if (from < text.length) parts.push(text.slice(from));
  return parts.map((part, index) =>
    typeof part === "string" ? (
      <Fragment key={index}>{part}</Fragment>
    ) : (
      <mark key={index} className="rounded bg-yellow-200 px-0.5 text-text">
        {part.match}
      </mark>
    ),
  );
}

/** Имя файла без расширения и регистра — «ОВ1.pdf» и «ОВ1» это один файл. */
function fileNameKey(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().toLowerCase().replace(/\.(pdf|dwg|dxf|zip)$/i, "");
}

/**
 * Колонка «Раздел» — заголовок расшифровки (Описание, Геометрия).
 * Имя файла, марка тома и «прочее» сюда не пишем: файл уже в шапке группы.
 */
function transcriptSection(section: string, fileName: string): string | null {
  const value = section.trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === "прочее" || lower === "без раздела") return null;
  if (fileNameKey(fileName) && fileNameKey(value) === fileNameKey(fileName)) return null;
  if (/\.(pdf|dxf|dwg|xlsx|zip)$/i.test(value)) return null;
  if (knownSectionRank(value) !== null || isCrossSection(value)) return null;
  return value;
}

type ColId =
  | "num"
  | "section"
  | "text"
  | "place"
  | "severity"
  | "verdict"
  | "comment"
  | "author";

const COL_WIDTH_KEY = "pto-review-col-widths";
const COL_DEFAULT: Record<ColId, number> = {
  num: 56,
  section: 140,
  text: 280,
  place: 220,
  severity: 112,
  verdict: 128,
  comment: 180,
  author: 120,
};
const COL_CHECK = 32;

const CELL = "border border-[#a6a6a6] px-1.5 py-1";

function loadColWidths(): Record<ColId, number> {
  if (typeof window === "undefined") return { ...COL_DEFAULT };
  try {
    const raw = localStorage.getItem(COL_WIDTH_KEY);
    if (!raw) return { ...COL_DEFAULT };
    const parsed = JSON.parse(raw) as Partial<Record<ColId, number>>;
    const next = { ...COL_DEFAULT };
    for (const key of Object.keys(COL_DEFAULT) as ColId[]) {
      const value = parsed[key];
      if (typeof value === "number" && value >= 48 && value <= 720) next[key] = value;
    }
    return next;
  } catch {
    return { ...COL_DEFAULT };
  }
}

function ColHead({
  width,
  minWidth,
  onDrag,
  colId,
  children,
}: {
  width?: number;
  minWidth?: number;
  onDrag?: (event: ReactPointerEvent) => void;
  colId?: string;
  children: ReactNode;
}) {
  const style =
    width != null
      ? { width, minWidth: width, maxWidth: width }
      : minWidth != null
        ? { minWidth }
        : undefined;
  return (
    <th
      style={style}
      className={`relative ${CELL} bg-[#d6dce4] font-semibold text-slate-900`}
    >
      {children}
      {onDrag ? (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label="Ширина колонки"
          data-col-resize={colId ?? ""}
          onPointerDown={onDrag}
          className="absolute -right-px top-0 z-20 h-full w-1.5 cursor-col-resize touch-none hover:bg-accent/40"
        />
      ) : null}
    </th>
  );
}

export function ReviewsTable({
  projectId,
  projectName,
  currentDocumentId = null,
  currentDocumentName = null,
  onJumpToPage,
  onOpenTranscript,
  onStatsChange,
  onReviewPatched,
  refreshToken = 0,
  onBack,
  onUndo,
  undoBusy = false,
}: {
  projectId: string;
  projectName: string;
  /** Открытый файл: в таблице только его замечания. */
  currentDocumentId?: string | null;
  /** Имя активного файла — запасное сопоставление, если в локации нет documentId. */
  currentDocumentName?: string | null;
  /** Перезагрузить таблицу, когда пометки на листе изменились. */
  refreshToken?: number;
  onReviewsMutated?: () => void;
  /** Один шаг туда, откуда открыли таблицу. Стоит рядом с поиском. */
  onBack?: () => void;
  /** Отмена последнего добавления или удаления замечания. */
  onUndo?: () => void;
  undoBusy?: boolean;
  /** Открыть место в ПД в просмотрщике (новая вкладка + подсветка). */
  onJumpToPage: (
    documentId: string,
    pageNumber: number,
    options?: { reviewId?: string; quote?: string; newTab?: boolean },
  ) => void;
  /** Уйти на этап расшифровки — из пустой таблицы это единственный выход. */
  onOpenTranscript?: () => void;
  /** Держит счётчик этапа «Замечания» в панели проекта в согласии с таблицей. */
  onStatsChange?: (stats: { total: number; pending: number }) => void;
  /** Статус из таблицы сразу виден в расшифровке и в полосе слева. */
  onReviewPatched?: (review: Review) => void;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  /** Строка, по которой открыто окно «что именно неверно». */
  const [wrongFor, setWrongFor] = useState<Review | null>(null);
  const [logFor, setLogFor] = useState<Review | null>(null);
  const [colFilters, setColFilters] = useState<ExcelColFilters>({});
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<ExcelCol>("number");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [colW, setColW] = useState(loadColWidths);
  const [picked, setPicked] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Серый XLSX: строка в другом файле — показать весь проект. */
  const [fileScopeOff, setFileScopeOff] = useState(false);
  const jumpId = useRef<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(`/api/projects/${projectId}/reviews`, {
        signal,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Не удалось загрузить замечания");
      }
      const payload = (await response.json()) as {
        reviews: Review[];
        events?: ReviewEvent[];
      };
      setReviews(payload.reviews ?? []);
      setEvents(payload.events ?? []);
    },
    [projectId],
  );

  /** После правки журнал обновляем отдельно: строку уже вернул PATCH. */
  const refreshEvents = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/reviews`);
      if (!response.ok) return;
      const payload = (await response.json()) as { events?: ReviewEvent[] };
      setEvents(payload.events ?? []);
    } catch {
      // журнал не критичен для разбора
    }
  }, [projectId]);

  /** Последняя правка по строке — подпись «кто и когда» прямо в таблице. */
  const lastEventByReview = useMemo(() => {
    const map = new Map<string, ReviewEvent>();
    for (const event of events) {
      if (event.field === "created") continue;
      if (!map.has(event.reviewId)) map.set(event.reviewId, event);
    }
    return map;
  }, [events]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    load(controller.signal)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Ошибка загрузки");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!refreshToken) return;
    void load().catch(() => undefined);
  }, [load, refreshToken]);

  useEffect(() => {
    setFileScopeOff(false);
  }, [currentDocumentId]);

  const filtersOn =
    Object.keys(colFilters).length > 0 || query.trim().length > 0;

  const currentFileKey = useMemo(
    () => fileNameKey(currentDocumentName),
    [currentDocumentName],
  );

  const scoped = useMemo(() => {
    if (!currentDocumentId || fileScopeOff) return reviews;
    return reviews.filter((item) =>
      item.locations.some(
        (loc) =>
          loc.documentId === currentDocumentId ||
          (!loc.documentId && fileNameKey(loc.documentName) === currentFileKey),
      ),
    );
  }, [currentDocumentId, currentFileKey, fileScopeOff, reviews]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return applyExcelFilters(scoped, colFilters).filter((item) => {
      if (!needle) return true;
      const haystack = [
        item.text,
        item.aiFinding,
        item.comment,
        item.section,
        reviewAuthor(item),
        ...item.locations.map((loc) => `${loc.documentName} ${loc.quote}`),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [colFilters, query, scoped]);

  const filterValues = useMemo(() => {
    const cols: ExcelCol[] = [
      "number",
      "section",
      "text",
      "place",
      "severity",
      "verdict",
      "comment",
      "author",
    ];
    return Object.fromEntries(
      cols.map((col) => [col, excelUniqueValues(scoped, col, colFilters)]),
    ) as Record<ExcelCol, string[]>;
  }, [colFilters, scoped]);

  /** Разбор идёт построчно, поэтому счётчик «сколько осталось» всегда на виду. */
  const stats = useMemo(() => {
    const total = reviews.length;
    const pending = reviews.filter((item) => item.verdict === "pending").length;
    // В выгрузку идёт то же, что и в XLSX: без «Не задана», «Не нужно», «Неактуально» и «Неверно».
    const exportable = reviews.filter(isExportableReview).length;
    const high = reviews.filter((item) => item.severity === "high").length;
    const ai = reviews.filter((item) => item.origin === "ai").length;
    const engineer = reviews.filter((item) => item.origin === "engineer").length;
    const both = reviews.filter((item) => item.origin === "both").length;
    const wrong = reviews.filter((item) => item.verdict === "wrong").length;
    return {
      total,
      pending,
      done: total - pending,
      exportable,
      high,
      ai,
      engineer,
      both,
      wrong,
    };
  }, [reviews]);

  const visibleExportable = useMemo(
    () =>
      visible.filter(isExportableReview),
    [visible],
  );

  useEffect(() => {
    onStatsChange?.({ total: stats.total, pending: stats.pending });
  }, [onStatsChange, stats.pending, stats.total]);

  /** Замечания без места идут последней группой, а не вперемешку с файлами. */
  const NO_FILE = "Без привязки к файлу";
  const fileOf = useCallback(
    (review: Review) => review.locations[0]?.documentName ?? NO_FILE,
    [],
  );

  const showSectionCol = useMemo(
    () => visible.some((review) => transcriptSection(review.section, fileOf(review))),
    [visible, fileOf],
  );
  const colCount = showSectionCol ? 9 : 8;

  function dragCol(id: ColId, event: ReactPointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const start = colW[id];
    function move(ev: Event) {
      const next = Math.max(
        48,
        Math.min(720, Math.round(start + (ev as PointerEvent).clientX - startX)),
      );
      setColW((prev) => {
        const merged = { ...prev, [id]: next };
        try {
          localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(merged));
        } catch {
          // quota / private
        }
        return merged;
      });
    }
    function up() {
      handle.releasePointerCapture?.(event.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const tableWidth =
    COL_CHECK +
    colW.num +
    (showSectionCol ? colW.section : 0) +
    colW.text +
    colW.place +
    colW.severity +
    colW.verdict +
    colW.comment +
    colW.author;

  const sorted = useMemo(() => {
    const items = [...visible];
    if (sortKey !== "number") {
      return items.sort((a, b) => {
        const left = excelColValues(a, sortKey)[0] ?? "";
        const right = excelColValues(b, sortKey)[0] ?? "";
        return left.localeCompare(right, "ru", { numeric: true }) * sortDir;
      });
    }
    // В комплекте из нескольких файлов чистый порядок по номеру перемешивал их
    // между собой: инженер проверяет файл целиком, а не прыгает между ними.
    // Номер строки при этом остаётся исходным — он виден в колонке «№».
    const files = [...new Set(items.map(fileOf))];
    if (files.length < 2) return items.sort((a, b) => (a.number - b.number) * sortDir);
    const rank = (review: Review) =>
      fileOf(review) === NO_FILE ? files.length : files.indexOf(fileOf(review));
    return items.sort(
      (a, b) => rank(a) - rank(b) || (a.number - b.number) * sortDir,
    );
  }, [fileOf, sortDir, sortKey, visible]);

  /**
   * Разделитель при смене файла. Только при сортировке по номеру: при сортировке
   * по колонке порядок задан не файлом, и группы получились бы рваными. Одного
   * файла на весь список тоже не размечаем — делить нечего.
   */
  const groupHeads = useMemo(() => {
    const heads = new Map<string, string>();
    if (sortKey !== "number") return heads;
    if (new Set(sorted.map(fileOf)).size < 2) return heads;
    let prev: string | null = null;
    for (const review of sorted) {
      const name = fileOf(review);
      if (name !== prev) heads.set(review.id, name);
      prev = name;
    }
    return heads;
  }, [fileOf, sortKey, sorted]);

  function sortBy(key: ExcelCol, dir: 1 | -1) {
    setSortKey(key);
    setSortDir(dir);
  }

  function applyColFilter(col: ExcelCol, next: string[] | null) {
    setColFilters((prev) => {
      const copy = { ...prev };
      if (!next) delete copy[col];
      else copy[col] = next;
      return copy;
    });
  }

  const patch = useCallback(
    async (reviewId: string, body: Partial<Review>) => {
      setSavingId(reviewId);
      const previous = reviews.find((item) => item.id === reviewId);
      const optimistic = previous ? { ...previous, ...body } : null;
      setReviews((prev) =>
        prev.map((item) =>
          item.id === reviewId ? { ...item, ...body } : item,
        ),
      );
      if (optimistic) onReviewPatched?.(optimistic);
      try {
        const response = await fetch(
          `/api/projects/${projectId}/reviews/${reviewId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error ?? "Не удалось сохранить");
        }
        const payload = (await response.json()) as { review: Review };
        setReviews((prev) =>
          prev.map((item) =>
            item.id === reviewId ? payload.review : item,
          ),
        );
        onReviewPatched?.(payload.review);
        setError(null);
        void refreshEvents();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка сохранения");
        if (previous) onReviewPatched?.(previous);
        await load().catch(() => undefined);
        return false;
      } finally {
        setSavingId(null);
      }
    },
    [load, onReviewPatched, projectId, refreshEvents, reviews],
  );

  async function handleImport(file: File) {
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(
        `/api/projects/${projectId}/reviews/import`,
        { method: "POST", body: form },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        added?: number;
        skipped?: number;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Не удалось импортировать");
      }
      await load();
      setColFilters({});
      setError(null);
      const added = payload.added ?? 0;
      const skipped = payload.skipped ?? 0;
      if (added === 0 && skipped > 0) {
        setError(`Все ${skipped} строк уже были в таблице`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка импорта");
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  async function downloadVisibleXlsx() {
    if (visibleExportable.length === 0) return;
    setExporting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/reviews/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewIds: visibleExportable.map((item) => item.id),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Не удалось выгрузить");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      const base = projectName.replace(/[\\/:*?"<>|]/g, "").trim() || "проект";
      link.href = url;
      link.download = filtersOn
        ? `${base} — замечания фильтр ${stamp}.xlsx`
        : `${base} — замечания ${stamp}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка выгрузки");
    } finally {
      setExporting(false);
    }
  }

  const leftover = reviews.filter(
    (item) => item.verdict === "pending" || item.severity === "unset",
  );
  function goToLeftover() {
    const next = leftover[0];
    if (!next) return;
    jumpId.current = next.id;
    if (!scoped.some((item) => item.id === next.id)) setFileScopeOff(true);
    if (!visible.some((item) => item.id === next.id)) {
      setColFilters({});
      setQuery("");
    }
    setActiveId(next.id);
  }

  useEffect(() => {
    const id = jumpId.current;
    if (!id) return;
    const node = document.querySelector(`[data-review-id="${id}"]`);
    if (!node) return;
    jumpId.current = null;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeId, scoped, visible]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      {/* «К проектам» живёт в шапке приложения — вторая кнопка тут дублировала. */}
      {/* Панель в одну строку: высота нужна чертежу и таблице, не кнопкам. */}
      <header className="flex items-center gap-2 border-b border-border bg-surface px-2 py-0.5">
        <div
          className="min-w-0 flex-1 truncate pto-t-md tabular-nums leading-tight"
          title={
            loading
              ? projectName
              : `${projectName}: ${stats.total} всего, ${stats.pending} не разобрано, выс. ${stats.high}, в выгрузку ${stats.exportable}, ИИ ${stats.ai}, инж. ${stats.engineer}`
          }
        >
          <span className="font-semibold text-text">
            Замечания · {projectName}
          </span>
          {loading ? <span className="text-muted"> · загрузка…</span> : null}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <ResolvedSummary reviews={reviews} projectId={projectId} compact />
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              title="Туда, откуда открыли таблицу"
              className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-0.5 pto-t-md font-semibold leading-none text-slate-800 hover:bg-slate-50"
            >
              ← Назад
            </button>
          ) : null}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск"
            className="w-32 rounded-md border border-border bg-white px-1.5 py-0.5 pto-t-md outline-none placeholder:text-muted focus:border-accent"
          />
          {onUndo ? (
            <button
              type="button"
              onClick={onUndo}
              disabled={undoBusy}
              title="Отменить последнее добавление или удаление замечания"
              className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-0.5 pto-t-md font-semibold leading-none text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              Отменить
            </button>
          ) : null}
          {currentDocumentId && fileScopeOff ? (
            <button
              type="button"
              onClick={() => setFileScopeOff(false)}
              className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-0.5 pto-t-md font-semibold leading-none text-slate-800 hover:bg-slate-50"
              title="Снова только замечания открытого файла"
            >
              Снова этот файл
            </button>
          ) : null}
          <input
            ref={importRef}
            type="file"
            accept=".xlsx,.xlsm,.csv,.txt"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImport(file);
            }}
          />
          <button
            type="button"
            disabled={importing}
            onClick={() => importRef.current?.click()}
            className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-0.5 pto-t-md font-semibold leading-none text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            title="Загрузить свой список замечаний из файла Excel"
          >
            {importing ? "Загрузка…" : "Мои замечания из Excel"}
          </button>
          {visibleExportable.length === 0 ||
          (!filtersOn && leftover.length > 0) ? (
            <button
              type="button"
              onClick={goToLeftover}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 pto-t-md font-semibold leading-none text-slate-500"
              title={
                leftover.length > 0
                  ? `Ещё ${leftover.length} без важности или разбора. Нажмите — перейти к строке`
                  : "Под текущий фильтр нечего выгружать"
              }
            >
              <IconDownload className="h-3.5 w-3.5" />
              {leftover.length > 0
                ? `Скачать Excel · ещё ${leftover.length}`
                : "Скачать таблицу Excel"}
            </button>
          ) : (
            <button
              type="button"
              disabled={exporting}
              onClick={() => void downloadVisibleXlsx()}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-accent px-2 py-0.5 pto-t-md font-semibold leading-none text-white hover:bg-[#1d4ed8] disabled:opacity-50"
              title={
                filtersOn
                  ? `Скачать отфильтрованные: ${visibleExportable.length}`
                  : "То, что разобрано — одним файлом Excel"
              }
            >
              <IconDownload className="h-3.5 w-3.5" />
              {exporting
                ? "…"
                : filtersOn
                  ? `Скачать Excel · ${visibleExportable.length}`
                  : "Скачать таблицу Excel"}
            </button>
          )}
          {reviews.some((item) => item.verdict !== "pending") ? (
            <button
              type="button"
              onClick={() => {
                for (const item of reviews) {
                  if (item.verdict !== "pending") {
                    void patch(item.id, { verdict: "pending" });
                  }
                }
              }}
              className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-0.5 pto-t-md font-semibold leading-none text-slate-800 hover:bg-slate-50"
              title="Вернуть всем статус «Не разобрано», как после расшифровки ИИ"
            >
              Сбросить разбор
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 pto-t-md text-red-700">
          {error}
        </div>
      ) : null}

      {picked.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent/5 px-3 py-1.5 text-xs">
          <span className="tabular-nums text-muted">выбрано {picked.length}</span>
          <select
            className="rounded border border-border bg-white px-2 py-1"
            defaultValue=""
            onChange={(event) => {
              const value = event.target.value as ReviewSeverity | "";
              if (!value) return;
              for (const id of picked) void patch(id, { severity: value });
              event.target.value = "";
            }}
          >
            <option value="">Важность…</option>
            {REVIEW_SEVERITY_ORDER.map((item) => (
              <option key={item} value={item}>
                {REVIEW_SEVERITY_LABEL[item]}
              </option>
            ))}
          </select>
          <select
            className="rounded border border-border bg-white px-2 py-1"
            defaultValue=""
            onChange={(event) => {
              const value = event.target.value as ReviewVerdict | "";
              if (!value || value === "wrong") return;
              for (const id of picked) void patch(id, { verdict: value });
              event.target.value = "";
            }}
          >
            <option value="">Статус…</option>
            {VERDICTS.filter((item) => item !== "wrong").map((item) => (
              <option key={item} value={item}>
                {REVIEW_VERDICT_LABEL[item]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="text-muted hover:text-text"
            onClick={() => setPicked([])}
          >
            Снять выбор
          </button>
        </div>
      ) : null}

      <div
        className="min-h-0 flex-1 overflow-auto outline-none"
        tabIndex={0}
        onKeyDown={(event) => {
          const flat = sorted;
          if (flat.length === 0) return;
          const index = Math.max(0, flat.findIndex((item) => item.id === activeId));
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveId(flat[Math.min(flat.length - 1, index + 1)].id);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveId(flat[Math.max(0, index - 1)].id);
          }
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-muted">
            <Spinner /> Загружаем замечания
          </div>
        ) : (
          // table-fixed: без него длинные ссылки в «Где в ПД» задавали
          // min-content колонки и выдавливали текст замечания в столбик.
          <table
            style={{ minWidth: tableWidth }}
            className="w-full table-fixed border-collapse border border-[#7f7f7f] text-xs"
          >
            <colgroup>
              <col style={{ width: COL_CHECK }} />
              <col style={{ width: colW.num }} />
              {showSectionCol ? <col style={{ width: colW.section }} /> : null}
              <col style={{ width: colW.text }} />
              <col style={{ width: colW.place }} />
              <col style={{ width: colW.severity }} />
              <col style={{ width: colW.verdict }} />
              <col />
              <col style={{ width: colW.author }} />
            </colgroup>
            <thead className="sticky top-0 z-10 text-left pto-t-sm">
              <tr>
                <th style={{ width: COL_CHECK }} className={CELL + " bg-[#d6dce4]"}>
                  <input
                    type="checkbox"
                    aria-label="Выбрать все видимые"
                    checked={
                      visible.length > 0 &&
                      visible.every((item) => picked.includes(item.id))
                    }
                    onChange={(event) => {
                      setPicked(
                        event.target.checked ? visible.map((item) => item.id) : [],
                      );
                    }}
                  />
                </th>
                <ColHead colId="num" width={colW.num} onDrag={(event) => dragCol("num", event)}>
                  <ExcelColFilter
                    label="№"
                    values={filterValues.number}
                    selected={colFilters.number ?? null}
                    sortDir={sortKey === "number" ? sortDir : null}
                    onSort={(dir) => sortBy("number", dir)}
                    onApply={(next) => applyColFilter("number", next)}
                  />
                </ColHead>
                {showSectionCol ? (
                  <ColHead
                    colId="section"
                    width={colW.section}
                    onDrag={(event) => dragCol("section", event)}
                  >
                    <ExcelColFilter
                      label="Раздел"
                      values={filterValues.section}
                      selected={colFilters.section ?? null}
                      sortDir={sortKey === "section" ? sortDir : null}
                      onSort={(dir) => sortBy("section", dir)}
                      onApply={(next) => applyColFilter("section", next)}
                    />
                  </ColHead>
                ) : null}
                <ColHead colId="text" width={colW.text} onDrag={(event) => dragCol("text", event)}>
                  <ExcelColFilter
                    label="Замечание"
                    values={filterValues.text}
                    selected={colFilters.text ?? null}
                    sortDir={sortKey === "text" ? sortDir : null}
                    onSort={(dir) => sortBy("text", dir)}
                    onApply={(next) => applyColFilter("text", next)}
                  />
                </ColHead>
                <ColHead colId="place" width={colW.place} onDrag={(event) => dragCol("place", event)}>
                  <ExcelColFilter
                    label="Где в ПД"
                    values={filterValues.place}
                    selected={colFilters.place ?? null}
                    sortDir={sortKey === "place" ? sortDir : null}
                    onSort={(dir) => sortBy("place", dir)}
                    onApply={(next) => applyColFilter("place", next)}
                  />
                </ColHead>
                <ColHead
                  colId="severity"
                  width={colW.severity}
                  onDrag={(event) => dragCol("severity", event)}
                >
                  <ExcelColFilter
                    label="Важность"
                    values={filterValues.severity}
                    selected={colFilters.severity ?? null}
                    sortDir={sortKey === "severity" ? sortDir : null}
                    onSort={(dir) => sortBy("severity", dir)}
                    onApply={(next) => applyColFilter("severity", next)}
                  />
                </ColHead>
                <ColHead
                  colId="verdict"
                  width={colW.verdict}
                  onDrag={(event) => dragCol("verdict", event)}
                >
                  <ExcelColFilter
                    label="Статус"
                    values={filterValues.verdict}
                    selected={colFilters.verdict ?? null}
                    sortDir={sortKey === "verdict" ? sortDir : null}
                    onSort={(dir) => sortBy("verdict", dir)}
                    onApply={(next) => applyColFilter("verdict", next)}
                  />
                </ColHead>
                <ColHead
                  colId="comment"
                  minWidth={colW.comment}
                  onDrag={(event) => dragCol("comment", event)}
                >
                  <ExcelColFilter
                    label="Комментарий"
                    values={filterValues.comment}
                    selected={colFilters.comment ?? null}
                    sortDir={sortKey === "comment" ? sortDir : null}
                    onSort={(dir) => sortBy("comment", dir)}
                    onApply={(next) => applyColFilter("comment", next)}
                  />
                </ColHead>
                <ColHead
                  colId="author"
                  width={colW.author}
                  onDrag={(event) => dragCol("author", event)}
                >
                  <ExcelColFilter
                    label="Автор"
                    values={filterValues.author}
                    selected={colFilters.author ?? null}
                    sortDir={sortKey === "author" ? sortDir : null}
                    onSort={(dir) => sortBy("author", dir)}
                    onApply={(next) => applyColFilter("author", next)}
                  />
                </ColHead>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-3 py-12">
                    <EmptyReviews
                      kind={
                        filtersOn
                          ? "filtered"
                          : reviews.length === 0
                            ? "none"
                            : currentDocumentId
                              ? "file"
                              : "filtered"
                      }
                      fileName={currentDocumentName}
                      onOpenTranscript={onOpenTranscript}
                      onShowWholeProject={
                        currentDocumentId && !fileScopeOff
                          ? () => setFileScopeOff(true)
                          : undefined
                      }
                      onResetFilters={() => {
                        setColFilters({});
                        setQuery("");
                      }}
                    />
                  </td>
                </tr>
              ) : null}
              {sorted.map((review) => (
                <Fragment key={review.id}>
                  {groupHeads.get(review.id) ? (
                    <tr>
                      <td
                        colSpan={colCount}
                        className={`${CELL} bg-[#e7e6e6] pto-t-sm font-semibold text-slate-800`}
                      >
                        {groupHeads.get(review.id)}
                      </td>
                    </tr>
                  ) : null}
                    <ReviewRow
                      review={review}
                      needle={query.trim().toLowerCase()}
                      active={activeId === review.id}
                      selected={picked.includes(review.id)}
                      saving={savingId === review.id}
                      lastEvent={lastEventByReview.get(review.id) ?? null}
                      showSection={showSectionCol}
                      sectionLabel={transcriptSection(review.section, fileOf(review))}
                      onActivate={() => setActiveId(review.id)}
                      onToggleSelect={() =>
                        setPicked((prev) =>
                          prev.includes(review.id)
                            ? prev.filter((id) => id !== review.id)
                            : [...prev, review.id],
                        )
                      }
                      onPatch={(body) => void patch(review.id, body)}
                      onMarkWrong={() => setWrongFor(review)}
                      onShowLog={() => setLogFor(review)}
                      onJumpToPage={onJumpToPage}
                    />
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {wrongFor ? (
        <WrongDialog
          review={wrongFor}
          onCancel={() => setWrongFor(null)}
          onSave={async (reason) => {
            const ok = await patch(wrongFor.id, {
              verdict: "wrong",
              wrongReason: reason,
            });
            if (ok) setWrongFor(null);
            return ok;
          }}
        />
      ) : null}

      {logFor ? (
        <ReviewLogDialog
          review={logFor}
          events={events.filter((item) => item.reviewId === logFor.id)}
          onClose={() => setLogFor(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * «Неверно» без объяснения — потерянный сигнал: строка уйдёт из выгрузки, а
 * конвейер останется с той же ошибкой. Поэтому статус ставится только вместе
 * с причиной.
 */
/**
 * Пустая таблица — самый частый первый экран инженера. Серая строка по центру
 * читается как «приложение сломалось», поэтому здесь всегда есть выход.
 */
function EmptyReviews({
  kind,
  fileName,
  onOpenTranscript,
  onShowWholeProject,
  onResetFilters,
}: {
  kind: "none" | "file" | "filtered";
  fileName: string | null;
  onOpenTranscript?: () => void;
  onShowWholeProject?: () => void;
  onResetFilters: () => void;
}) {
  const title =
    kind === "none"
      ? "Замечаний пока нет"
      : kind === "file"
        ? `По файлу ${fileName ?? "этому"} замечаний нет`
        : "Под фильтры ничего не попало";
  const hint =
    kind === "none"
      ? "Конвейер их ещё не присылал. Своё замечание ставят на чертеже: откройте лист и нажмите «Отметить ошибку» — строка появится здесь сама."
      : kind === "file"
        ? "По другим файлам проекта замечания могут быть."
        : "Снимите фильтры по колонкам или очистите поиск.";

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-muted">
        <IconDoc className="h-5 w-5" />
      </div>
      <div>
        <div className="text-sm font-semibold text-text">{title}</div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {kind === "filtered" ? (
          <button
            type="button"
            onClick={onResetFilters}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1d4ed8]"
          >
            Сбросить фильтры
          </button>
        ) : null}
        {onOpenTranscript ? (
          <button
            type="button"
            onClick={onOpenTranscript}
            className={
              kind === "filtered"
                ? "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                : "rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1d4ed8]"
            }
          >
            Открыть расшифровку
          </button>
        ) : null}
        {onShowWholeProject ? (
          <button
            type="button"
            onClick={onShowWholeProject}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            Показать весь проект
          </button>
        ) : null}
      </div>
    </div>
  );
}

function WrongDialog({
  review,
  onCancel,
  onSave,
}: {
  review: Review;
  onCancel: () => void;
  onSave: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState(review.wrongReason);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const text = reason.trim();
    if (!text) return;
    setBusy(true);
    const ok = await onSave(text);
    if (!ok) setBusy(false);
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Что неверно в замечании"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-sm font-semibold text-rose-900">
          Замечание № {review.number} неверно
        </div>
        <div className="mt-1 line-clamp-3 pto-t-md leading-snug text-muted">
          {review.text || review.aiFinding}
        </div>
        <textarea
          autoFocus
          value={reason}
          rows={3}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Что именно неверно: в чертеже этого нет, числа сходятся…"
          className="mt-2 w-full resize-none rounded-md border border-border bg-white px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
        <div className="mt-1.5 flex flex-wrap gap-1">
          {WRONG_TAGS.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() =>
                setReason((prev) =>
                  prev.trim() ? `${prev.trim()}. ${label}` : label,
                )
              }
              className="rounded-full border border-rose-200 bg-white px-2 py-0.5 pto-t-sm text-rose-800 hover:bg-rose-50"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || reason.trim().length === 0}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-50"
          >
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs"
          >
            Отмена
          </button>
          <span className="ml-auto pto-t-sm text-muted">Ctrl+Enter</span>
        </div>
      </div>
    </div>
  );
}

/** Журнал строки: кто и когда менял важность, разбор и комментарий. */
function ReviewLogDialog({
  review,
  events,
  onClose,
}: {
  review: Review;
  events: ReviewEvent[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Журнал разбора замечания"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-white p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-medium">
            Журнал замечания № {review.number}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted hover:text-text"
          >
            Закрыть
          </button>
        </div>
        <div className="max-h-72 space-y-1.5 overflow-auto">
          {events.length === 0 ? (
            <div className="text-xs text-muted">
              Правок не было — замечание в том виде, в котором пришло.
            </div>
          ) : (
            events.map((event) => (
              <div
                key={event.id}
                className="rounded-md bg-surface-2 px-2 py-1.5 pto-t-md leading-snug"
              >
                <div className="text-muted">
                  {formatDate(event.at)}
                  {event.userName ? ` · ${event.userName}` : ""}
                </div>
                <div className="text-text">
                  {REVIEW_EVENT_LABEL[event.field]}
                  {event.field === "created" || event.field === "deleted"
                    ? ""
                    : `: ${verdictish(event.field, event.from)} → ${verdictish(
                        event.field,
                        event.to,
                      )}`}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** В журнале лежат коды (`high`, `wrong`) — читаем их по-русски. */
function verdictish(field: ReviewEvent["field"], value: string): string {
  if (!value) return "пусто";
  if (field === "severity") {
    return REVIEW_SEVERITY_LABEL[value as ReviewSeverity] ?? value;
  }
  if (field === "verdict") {
    const [code, ...rest] = value.split(":");
    const label = REVIEW_VERDICT_LABEL[code.trim() as ReviewVerdict] ?? code;
    const reason = rest.join(":").trim();
    return reason ? `${label} (${reason})` : label;
  }
  return value;
}

function locationHead(location: ReviewLocation, omitFile: boolean): string {
  return [omitFile ? null : location.documentName || "без раздела", sheetLabel(location)]
    .filter(Boolean)
    .join(" · ");
}

type JumpToPage = (
  documentId: string,
  pageNumber: number,
  options?: { reviewId?: string; quote?: string; newTab?: boolean },
) => void;

/**
 * Конвейер начинает формулировку с «файл.pdf, стр. N: » или «лист 6, стр. 1» —
 * это дубль колонки «Где в ПД», и он съедал обе видимые строки, так что суть
 * расхождения в таблице не читалась. При рендере срезаем; в данных префикс
 * остаётся, иначе сломается сверка с тем, что прислал конвейер.
 */
export function stripRemarkPlacePrefix(wording: string): string {
  return remarkWording(wording);
}

/** Формулировка в 3 строки; находка ИИ — за «ещё». «Неверно» всегда видно. */
function RemarkText({
  wording,
  needle,
  aiFinding,
  wrongReason,
}: {
  wording: string;
  needle: string;
  aiFinding: string;
  wrongReason: string;
}) {
  const [open, setOpen] = useState(false);
  const clampRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    if (open) return;
    const el = clampRef.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, wording]);

  const needleHitsAi =
    Boolean(needle && aiFinding && aiFinding.toLowerCase().includes(needle));
  const expanded = open || needleHitsAi;
  const showToggle = Boolean(aiFinding) || overflows;
  // Свёрнутым показываем формулировку без дубля места; раскрытым — как пришла.
  const shown = expanded ? wording : stripRemarkPlacePrefix(wording);

  return (
    // Колонка гибкая, и на широком мониторе замечание растягивалось строкой на
    // 1600px. Ограничиваем длину строки, как в расшифровке.
    <div className="min-w-0 max-w-[78ch]">
      <div
        ref={clampRef}
        className={`whitespace-pre-wrap leading-snug text-text ${
          expanded ? "" : "line-clamp-3"
        }`}
      >
        {highlight(shown, needle)}
      </div>
      {expanded && aiFinding ? (
        <div className="mt-1 whitespace-pre-wrap border-l-2 border-slate-300 pl-2 pto-t-md leading-snug text-muted">
          Нашла ИИ: {highlight(aiFinding, needle)}
        </div>
      ) : null}
      {wrongReason ? (
        <div className="mt-1 whitespace-pre-wrap border-l-2 border-rose-400 pl-2 pto-t-md leading-snug text-rose-800">
          Неверно: {highlight(wrongReason, needle)}
        </div>
      ) : null}
      {showToggle && !needleHitsAi ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          className="mt-0.5 pto-t-sm text-muted underline decoration-dotted hover:text-text"
        >
          {expanded ? "свернуть" : "ещё"}
        </button>
      ) : null}
    </div>
  );
}

function LocationLine({
  location,
  omitFile,
  needle,
  wording,
  reviewId,
  onJumpToPage,
}: {
  location: ReviewLocation;
  omitFile: boolean;
  needle: string;
  wording: string;
  reviewId: string;
  onJumpToPage: JumpToPage;
}) {
  const head = locationHead(location, omitFile);
  const jumpable = Boolean(location.documentId && location.pageNumber);
  const title = [head, location.quote ? `«${location.quote}»` : null]
    .filter(Boolean)
    .join(" · ");

  const body = location.quote ? (
    <>
      <span className="font-medium">{highlight(head || "без места", needle)}</span>
      <span> · «{highlight(location.quote, needle)}»</span>
    </>
  ) : (
    <span className="font-medium">
      {highlight(head || (jumpable ? "открыть лист" : "—"), needle)}
    </span>
  );

  if (!jumpable) {
    return (
      <span
        title={title}
        className="block truncate pto-t-md leading-snug text-text"
      >
        {body}
      </span>
    );
  }

  return (
    <button
      type="button"
      title={`Открыть на чертеже: ${title}`}
      onClick={(event) => {
        event.stopPropagation();
        onJumpToPage(location.documentId!, location.pageNumber!, {
          reviewId,
          quote: location.quote || wording || undefined,
          newTab: event.ctrlKey || event.metaKey,
        });
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        onJumpToPage(location.documentId!, location.pageNumber!, {
          reviewId,
          quote: location.quote || wording || undefined,
          newTab: true,
        });
      }}
      className="block max-w-full truncate rounded px-0.5 -mx-0.5 text-left pto-t-md leading-snug text-accent hover:bg-rose-50 hover:no-underline"
    >
      <span className="underline decoration-dotted">{body}</span>
    </button>
  );
}

/** Все места одного расхождения сразу видны — иначе инженер правит одно и не видит второе. */
function ReviewLocations({
  review,
  needle,
  wording,
  onJumpToPage,
}: {
  review: Review;
  needle: string;
  wording: string;
  onJumpToPage: JumpToPage;
}) {
  const many = review.locations.length > 1;

  return (
    <ul className="min-w-0 space-y-0.5">
      {review.locations.map((location, index) => (
        <li
          key={`${location.documentId}-${location.pageNumber}-${index}`}
          className="flex min-w-0 items-baseline gap-1"
        >
          {many ? (
            <span className="shrink-0 tabular-nums pto-t-sm text-muted">
              {placeOrdinal(index)}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <LocationLine
              location={location}
              omitFile
              needle={needle}
              wording={wording}
              reviewId={review.id}
              onJumpToPage={onJumpToPage}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Нативный select красит все пункты цветом выбранного. Список рисуем сами:
 * у каждого значения свой чип, «высокий» не заливает «средний» и «низкий».
 */
function StatusPicker<T extends string>({
  value,
  options,
  labels,
  chips,
  field,
  ariaLabel,
  onChange,
}: {
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  chips: Record<T, string>;
  field: string;
  ariaLabel: string;
  onChange: (next: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function placeMenu(el: HTMLElement) {
    const box = el.getBoundingClientRect();
    const width = Math.max(box.width, 148);
    const below = box.bottom + 4;
    const approxH = options.length * 30 + 8;
    const top =
      below + approxH > window.innerHeight - 8
        ? Math.max(8, box.top - approxH - 4)
        : below;
    setMenu({ top, left: box.left, width });
    setOpen(true);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-status-field={field}
        data-status-value={value}
        onClick={(event) => {
          event.stopPropagation();
          if (open) setOpen(false);
          else placeMenu(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            if (!open) {
              event.preventDefault();
              placeMenu(event.currentTarget);
            }
          }
        }}
        className={`w-full rounded border px-1.5 py-1 text-left pto-t-md font-medium ${chips[value]}`}
      >
        {labels[value]}
      </button>
      {open && menu ? (
        <div
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: "fixed",
            top: menu.top,
            left: menu.left,
            width: menu.width,
          }}
          className="z-50 rounded border border-slate-300 bg-white p-0.5 shadow-md"
        >
          {options.map((item) => (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={item === value}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                if (item !== value) onChange(item);
              }}
              className={`mb-0.5 block w-full rounded border px-1.5 py-1 text-left pto-t-md font-medium last:mb-0 ${chips[item]}`}
            >
              {labels[item]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReviewRow({
  review,
  needle,
  active,
  selected,
  saving,
  lastEvent,
  showSection,
  sectionLabel,
  onActivate,
  onToggleSelect,
  onPatch,
  onMarkWrong,
  onShowLog,
  onJumpToPage,
}: {
  review: Review;
  /** Уже приведённая к нижнему регистру строка поиска — что подсветить. */
  needle: string;
  active: boolean;
  selected: boolean;
  saving: boolean;
  /** Последняя правка строки — подпись «кто и когда». */
  lastEvent: ReviewEvent | null;
  showSection: boolean;
  sectionLabel: string | null;
  onActivate: () => void;
  onToggleSelect: () => void;
  onPatch: (body: Partial<Review>) => void;
  onMarkWrong: () => void;
  onShowLog: () => void;
  onJumpToPage: (
    documentId: string,
    pageNumber: number,
    options?: { reviewId?: string; quote?: string; newTab?: boolean },
  ) => void;
}) {
  const [comment, setComment] = useState(review.comment);
  const commentRef = useRef(review.comment);
  /** Поле заметки развёрнуто: у заполненных — сразу, у пустых — по клику. */
  const [commentOpen, setCommentOpen] = useState(false);
  const commentFieldRef = useRef<HTMLTextAreaElement>(null);
  /** Показываем «сохранено» пару секунд: иначе непонятно, ушла ли заметка. */
  const [savedFlash, setSavedFlash] = useState(false);

  // Раскрыли по клику — ставим курсор в поле, иначе нужен второй клик.
  useEffect(() => {
    if (commentOpen) commentFieldRef.current?.focus();
  }, [commentOpen]);

  // Правку с сервера подхватываем, набранный текст не сбрасываем.
  useEffect(() => {
    if (review.comment !== commentRef.current) {
      commentRef.current = review.comment;
      setComment(review.comment);
    }
  }, [review.comment]);

  useEffect(() => {
    if (!savedFlash) return;
    const timer = window.setTimeout(() => setSavedFlash(false), 2000);
    return () => window.clearTimeout(timer);
  }, [savedFlash]);

  const commentDirty = comment.trim() !== review.comment;

  function commitComment() {
    const next = comment.trim();
    if (next === review.comment) return;
    commentRef.current = next;
    onPatch({ comment: next });
    setSavedFlash(true);
    if (!next) setCommentOpen(false);
  }

  const wording = review.text || review.aiFinding;
  const edge = (side: "first" | "mid" | "last") =>
    severityCellFrame(review.severity, side);

  return (
    <tr
      onClick={onActivate}
      // Строка переезжает при смене важности и разбора — тестам нужна опора на id.
      data-review-id={review.id}
      className={`align-top ${SEVERITY_ROW[review.severity] || "bg-white"} ${
        active ? "outline outline-2 -outline-offset-2 outline-accent" : ""
      }`}
    >
      <td className={`${CELL} px-1 ${edge("first")}`}>
        <input
          type="checkbox"
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onChange={onToggleSelect}
          aria-label={`Выбрать замечание ${review.number}`}
        />
      </td>
      <td className={`${CELL} tabular-nums text-muted ${edge("mid")}`}>
        <span className="inline-flex items-center gap-1">
          {review.number}
          {review.verdict === "pending" ? null : (
            <Tooltip label={`Разобрано: ${REVIEW_VERDICT_LABEL[review.verdict]}`}>
              <VerdictDot verdict={review.verdict} />
            </Tooltip>
          )}
        </span>
      </td>
      {showSection ? (
        <td className={`${CELL} ${edge("mid")}`}>
          {sectionLabel ? (
            <span className="rounded border border-slate-300 bg-white px-1.5 py-0.5 pto-t-sm font-medium text-text">
              {sectionLabel}
            </span>
          ) : null}
        </td>
      ) : null}
      <td className={`${CELL} ${edge("mid")}`}>
        <RemarkText
          wording={wording}
          needle={needle}
          aiFinding={review.text && review.aiFinding ? review.aiFinding : ""}
          wrongReason={review.wrongReason}
        />
      </td>
      <td className={`${CELL} ${edge("mid")}`}>
        {review.needsRecheck ? (
          <div className="mb-1 pto-t-sm font-medium text-amber-800">
            нужно перепроверить
          </div>
        ) : null}
        {review.locations.length === 0 ? (
          <span className="pto-t-md text-muted">
            {review.origin !== "ai" && !review.needsRecheck
              ? "ждёт обогащения"
              : "—"}
          </span>
        ) : (
          <ReviewLocations
            review={review}
            needle={needle}
            wording={wording}
            onJumpToPage={onJumpToPage}
          />
        )}
      </td>
      <td className={`${CELL} ${edge("mid")}`}>
        <StatusPicker
          field="severity"
          ariaLabel={`Важность замечания ${review.number}`}
          value={review.severity}
          options={REVIEW_SEVERITY_ORDER}
          labels={REVIEW_SEVERITY_LABEL}
          chips={SEVERITY_CHIP}
          onChange={(next) => onPatch({ severity: next })}
        />
      </td>
      <td className={`${CELL} ${edge("mid")}`}>
        <StatusPicker
          field="verdict"
          ariaLabel={`Статус замечания ${review.number}`}
          value={review.verdict}
          options={VERDICTS}
          labels={REVIEW_VERDICT_LABEL}
          chips={VERDICT_CHIP}
          onChange={(next) => {
            if (next === "wrong") onMarkWrong();
            else onPatch({ verdict: next });
          }}
        />
        {review.verdict === "wrong" ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onMarkWrong();
            }}
            className="mt-1 w-full rounded border border-rose-200 bg-white px-1 py-0.5 pto-t-sm text-rose-800 hover:bg-rose-50"
          >
            Уточнить причину
          </button>
        ) : null}
      </td>
      <td className={`${CELL} ${edge("mid")}`}>
        {/* Поле открывается по клику: пятнадцать пустых textarea в столбик
            занимали половину строки и мешали читать сами замечания. */}
        {commentOpen ? (
          <textarea
            ref={commentFieldRef}
            value={comment}
            rows={3}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                commitComment();
              }
              if (event.key === "Escape" && !commentDirty) setCommentOpen(false);
            }}
            onClick={(event) => event.stopPropagation()}
            placeholder="Заметка проверяющего"
            className={`w-full resize-y rounded border bg-white px-1.5 py-1 pto-t-md outline-none placeholder:text-muted focus:border-accent ${
              commentDirty ? "border-accent" : "border-slate-300"
            }`}
          />
        ) : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setCommentOpen(true);
            }}
            data-comment-toggle=""
            title={review.comment || "Добавить заметку проверяющего"}
            className={`w-full truncate rounded border border-dashed px-1.5 py-1 text-left pto-t-md ${
              review.comment
                ? "border-slate-300 bg-white text-text hover:border-accent"
                : "border-slate-300 text-muted hover:border-accent hover:text-accent"
            }`}
          >
            {review.comment || "+ заметка"}
          </button>
        )}
        {/* Заметка сохраняется только по кнопке: раньше она уходила молча по
            потере фокуса, и было непонятно, записалась ли. */}
        <div className="mt-0.5 flex min-h-[1.1rem] items-center gap-1.5">
          {commentDirty ? (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  commitComment();
                }}
                className="rounded bg-accent px-1.5 py-0.5 pto-t-sm font-semibold text-white hover:bg-[#1d4ed8]"
              >
                Сохранить
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setComment(review.comment);
                  setCommentOpen(Boolean(review.comment));
                }}
                className="rounded border border-slate-300 px-1.5 py-0.5 pto-t-sm text-muted hover:text-text"
              >
                Отмена
              </button>
            </>
          ) : savedFlash ? (
            <span className="pto-t-sm text-emerald-700">Сохранено</span>
          ) : lastEvent ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onShowLog();
              }}
              title="Журнал правок этого замечания"
              className="truncate pto-t-sm text-muted underline decoration-dotted hover:text-text"
            >
              {`${REVIEW_EVENT_LABEL[lastEvent.field].toLowerCase()} · ${
                lastEvent.userName ?? "система"
              } · ${formatDate(lastEvent.at)}`}
            </button>
          ) : null}
        </div>
      </td>
      <td className={`${CELL} ${edge("last")}`}>
        <span className="inline-flex items-center gap-1">
          <span
            className={`inline-block rounded border px-1.5 py-0.5 pto-t-sm font-medium ${
              ORIGIN_CHIP[review.origin]
            }`}
          >
            {reviewAuthor(review)}
          </span>
          {saving ? <Spinner className="h-3 w-3 text-accent" /> : null}
        </span>
      </td>
    </tr>
  );
}
