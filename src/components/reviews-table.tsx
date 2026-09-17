"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ExcelColFilter } from "@/components/excel-col-filter";
import { Spinner } from "@/components/ui-chrome";
import { IconDownload } from "@/components/tool-icons";
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
  VERDICT_ROW,
} from "@/lib/review-colors";
import { formatDate } from "@/lib/format";
import {
  REVIEW_EVENT_LABEL,
  REVIEW_ORIGIN_LABEL,
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

/** Потоки не смешиваются: находки конвейера и замечания инженеров различимы. */
const ORIGIN_CHIP: Record<ReviewOrigin, string> = {
  ai: "border-violet-300 bg-violet-50 text-violet-900",
  engineer: "border-slate-300 bg-white text-muted",
  both: "border-sky-300 bg-sky-50 text-sky-900",
};

const ORIGIN_SHORT: Record<ReviewOrigin, string> = {
  ai: "ИИ",
  engineer: "Инженер",
  both: "Совпало",
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

export function ReviewsTable({
  projectId,
  projectName,
  currentDocumentId = null,
  currentDocumentName = null,
  onJumpToPage,
  onStatsChange,
  onClose,
  refreshToken = 0,
  onReviewsMutated,
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
  /** Открыть место в ПД в просмотрщике (новая вкладка + подсветка). */
  onJumpToPage: (
    documentId: string,
    pageNumber: number,
    options?: { reviewId?: string; quote?: string; newTab?: boolean },
  ) => void;
  /** Держит счётчик этапа «Замечания» в панели проекта в согласии с таблицей. */
  onStatsChange?: (stats: { total: number; pending: number }) => void;
  onClose: () => void;
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
  const [picked, setPicked] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [enriching, setEnriching] = useState(false);
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

  const sorted = useMemo(() => {
    return [...visible].sort((a, b) => {
      if (sortKey === "number") return (a.number - b.number) * sortDir;
      const left = excelColValues(a, sortKey)[0] ?? "";
      const right = excelColValues(b, sortKey)[0] ?? "";
      return left.localeCompare(right, "ru", { numeric: true }) * sortDir;
    });
  }, [sortDir, sortKey, visible]);

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
      // Оптимистично: разбор идёт быстро, ждать ответ на каждый клик нельзя.
      setReviews((prev) =>
        prev.map((item) =>
          item.id === reviewId ? { ...item, ...body } : item,
        ),
      );
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
        setError(null);
        void refreshEvents();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка сохранения");
        await load().catch(() => undefined);
        return false;
      } finally {
        setSavingId(null);
      }
    },
    [load, projectId, refreshEvents],
  );

  async function handleDelete(reviewId: string) {
    if (!confirm("Удалить замечание?")) return;
    setSavingId(reviewId);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/reviews/${reviewId}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Не удалось удалить");
      setReviews((prev) => prev.filter((item) => item.id !== reviewId));
      void refreshEvents();
      onReviewsMutated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления");
    } finally {
      setSavingId(null);
    }
  }

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

  async function handleEnrich() {
    setEnriching(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/reviews/enrich`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        enriched?: number;
        updated?: number;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Не удалось обогатить");
      }
      await load();
      setError(null);
      if (payload.message) setError(payload.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка обогащения");
    } finally {
      setEnriching(false);
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
  const pendingEnrich = reviews.filter(
    (item) =>
      item.origin !== "ai" &&
      item.text &&
      (item.locations.length === 0 || item.needsRecheck),
  ).length;

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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f4f6f9]">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-2 py-1">
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold text-white shadow-sm hover:bg-[#1d4ed8]"
          title="Главная: все проекты, список слева"
        >
          ← К проектам
        </button>
        <div
          className="min-w-0 flex-1 truncate text-[11px] tabular-nums leading-tight"
          title={
            loading
              ? projectName
              : `${projectName}: ${stats.total} всего, ${stats.pending} не разобрано, выс. ${stats.high}, в выгрузку ${stats.exportable}, ИИ ${stats.ai}, инж. ${stats.engineer}`
          }
        >
          <span className="font-semibold text-text">
            Замечания · {projectName}
          </span>
          {loading ? (
            <span className="text-muted"> · загрузка…</span>
          ) : (
            <span className="text-muted">
              {` · ${stats.total} всего · ${stats.pending} не разобрано · выс. ${stats.high} · выгрузка ${stats.exportable} · ИИ ${stats.ai} · инж. ${stats.engineer}`}
              {stats.both ? ` · оба ${stats.both}` : ""}
              {stats.wrong ? (
                <span className="text-rose-700">{` · брак ${stats.wrong}`}</span>
              ) : null}
            </span>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск"
            className="w-32 rounded-md border border-border bg-white px-1.5 py-0.5 text-[11px] outline-none placeholder:text-muted focus:border-accent"
          />
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
            className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            title="Загрузить свой список замечаний из файла Excel"
          >
            {importing ? "Загрузка…" : "Мои замечания из Excel"}
          </button>
          <button
            type="button"
            disabled={enriching || pendingEnrich === 0}
            onClick={() => void handleEnrich()}
            className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            title="Для строк из Excel без листа: проставить раздел, номер листа и цитату в колонке «Где в ПД»"
          >
            {enriching
              ? "Ищем места…"
              : pendingEnrich
                ? `Проставить, где в ПД · ${pendingEnrich}`
                : "Проставить, где в ПД"}
          </button>
          {visibleExportable.length === 0 ||
          (!filtersOn && leftover.length > 0) ? (
            <button
              type="button"
              onClick={goToLeftover}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500"
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
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-50"
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
              className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50"
              title="Вернуть всем статус «Не разобрано», как после расшифровки ИИ"
            >
              Сбросить разбор
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-3 py-1">
        <span className="text-[11px] text-muted">
          Фильтры — стрелка на колонке, как в Excel
        </span>
        {filtersOn ? (
          <button
            type="button"
            onClick={() => {
              setColFilters({});
              setQuery("");
            }}
            className="rounded-md border border-border bg-white px-2 py-1 text-[11px] text-muted hover:text-text"
            title="Показать все замечания"
          >
            Сбросить фильтры
          </button>
        ) : null}
        <span className="text-[11px] tabular-nums text-muted">
          показано {visible.length}
        </span>
        {currentDocumentId && fileScopeOff ? (
          <button
            type="button"
            onClick={() => setFileScopeOff(false)}
            className="rounded-md border border-border bg-white px-2 py-1 text-[11px] text-muted hover:text-text"
            title="Снова только замечания открытого файла"
          >
            Снова этот файл
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">
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
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 text-left text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="w-8 border-b border-border px-1 py-1.5">
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
                <th className="w-14 border-b border-border px-2 py-1.5 font-medium normal-case tracking-normal">
                  <ExcelColFilter
                    label="№"
                    values={filterValues.number}
                    selected={colFilters.number ?? null}
                    sortDir={sortKey === "number" ? sortDir : null}
                    onSort={(dir) => sortBy("number", dir)}
                    onApply={(next) => applyColFilter("number", next)}
                  />
                </th>
                <th className="w-28 border-b border-border px-2 py-1.5 font-medium normal-case tracking-normal">
                  <ExcelColFilter
                    label="Раздел"
                    values={filterValues.section}
                    selected={colFilters.section ?? null}
                    sortDir={sortKey === "section" ? sortDir : null}
                    onSort={(dir) => sortBy("section", dir)}
                    onApply={(next) => applyColFilter("section", next)}
                  />
                </th>
                <th className="border-b border-border px-2 py-1.5 font-medium normal-case tracking-normal">
                  <ExcelColFilter
                    label="Замечание"
                    values={filterValues.text}
                    selected={colFilters.text ?? null}
                    sortDir={sortKey === "text" ? sortDir : null}
                    onSort={(dir) => sortBy("text", dir)}
                    onApply={(next) => applyColFilter("text", next)}
                  />
                </th>
                <th className="w-64 border-b border-border px-2 py-1.5 font-medium normal-case tracking-normal">
                  <ExcelColFilter
                    label="Где в ПД"
                    values={filterValues.place}
                    selected={colFilters.place ?? null}
                    sortDir={sortKey === "place" ? sortDir : null}
                    onSort={(dir) => sortBy("place", dir)}
                    onApply={(next) => applyColFilter("place", next)}
                  />
                </th>
                <th className="w-32 border-b border-border px-2 py-1.5 font-medium normal-case tracking-normal">
                  <ExcelColFilter
                    label="Важность"
                    values={filterValues.severity}
                    selected={colFilters.severity ?? null}
                    sortDir={sortKey === "severity" ? sortDir : null}
                    onSort={(dir) => sortBy("severity", dir)}
                    onApply={(next) => applyColFilter("severity", next)}
                  />
                </th>
                <th className="w-36 border-b border-border px-2 py-1.5 font-medium normal-case tracking-normal">
                  <ExcelColFilter
                    label="Статус"
                    values={filterValues.verdict}
                    selected={colFilters.verdict ?? null}
                    sortDir={sortKey === "verdict" ? sortDir : null}
                    onSort={(dir) => sortBy("verdict", dir)}
                    onApply={(next) => applyColFilter("verdict", next)}
                  />
                </th>
                <th className="w-48 border-b border-border px-2 py-1.5 font-medium normal-case tracking-normal">
                  <ExcelColFilter
                    label="Комментарий"
                    values={filterValues.comment}
                    selected={colFilters.comment ?? null}
                    sortDir={sortKey === "comment" ? sortDir : null}
                    onSort={(dir) => sortBy("comment", dir)}
                    onApply={(next) => applyColFilter("comment", next)}
                  />
                </th>
                <th className="w-8 border-b border-border px-1 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-10 text-center text-xs text-muted"
                  >
                    {reviews.length === 0
                      ? "Замечаний пока нет — конвейер их ещё не присылал. Можно добавить своё ниже."
                      : currentDocumentId
                        ? "По этому файлу замечаний нет."
                        : "Под фильтры ничего не попало."}
                  </td>
                </tr>
              ) : null}
              {sorted.map((review) => (
                    <ReviewRow
                      key={review.id}
                      review={review}
                      needle={query.trim().toLowerCase()}
                      active={activeId === review.id}
                      selected={picked.includes(review.id)}
                      saving={savingId === review.id}
                      lastEvent={lastEventByReview.get(review.id) ?? null}
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
                      onDelete={() => void handleDelete(review.id)}
                      onJumpToPage={onJumpToPage}
                    />
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
        className="w-full max-w-md rounded-lg border border-rose-200 bg-white p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-sm font-semibold text-rose-900">
          Замечание № {review.number} неверно
        </div>
        <div className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted">
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
              className="rounded-full border border-rose-200 bg-white px-2 py-0.5 text-[10px] text-rose-800 hover:bg-rose-50"
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
          <span className="ml-auto text-[10px] text-muted">Ctrl+Enter</span>
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
        className="w-full max-w-md rounded-lg border border-border bg-white p-4 shadow-xl"
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
                className="rounded-md bg-surface-2 px-2 py-1.5 text-[11px] leading-snug"
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

/** 1 место, 2 места, 5 мест — для «ещё N» в «Где в ПД». */
function ruPlaces(count: number): string {
  const abs = Math.abs(count) % 100;
  const digit = abs % 10;
  if (abs > 10 && abs < 20) return "мест";
  if (digit === 1) return "место";
  if (digit >= 2 && digit <= 4) return "места";
  return "мест";
}

function locationHead(location: ReviewLocation, omitFile: boolean): string {
  return [
    omitFile ? null : location.documentName || "без раздела",
    location.pageNumber ? `стр. ${location.pageNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

type JumpToPage = (
  documentId: string,
  pageNumber: number,
  options?: { reviewId?: string; quote?: string; newTab?: boolean },
) => void;

/** Формулировка в 2 строки; находка ИИ — за «ещё». «Неверно» всегда видно. */
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

  return (
    <div className="min-w-0">
      <div
        ref={clampRef}
        className={`whitespace-pre-wrap leading-snug text-text ${
          expanded ? "" : "line-clamp-2"
        }`}
      >
        {highlight(wording, needle)}
      </div>
      {expanded && aiFinding ? (
        <div className="mt-1 whitespace-pre-wrap border-l-2 border-violet-300 pl-2 text-[11px] leading-snug text-muted">
          Нашла ИИ: {highlight(aiFinding, needle)}
        </div>
      ) : null}
      {wrongReason ? (
        <div className="mt-1 whitespace-pre-wrap border-l-2 border-rose-400 pl-2 text-[11px] leading-snug text-rose-800">
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
          className="mt-0.5 text-[10px] text-muted underline decoration-dotted hover:text-text"
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
        className="block truncate text-[11px] leading-snug text-text"
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
      className="block max-w-full truncate rounded px-0.5 -mx-0.5 text-left text-[11px] leading-snug text-accent hover:bg-rose-50 hover:no-underline"
    >
      <span className="underline decoration-dotted">{body}</span>
    </button>
  );
}

/** Карточки мест раздували строку — одна строка на место, с 3-го «ещё N». */
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
  const [open, setOpen] = useState(false);
  const collapse = review.locations.length > 2;
  const hiddenNeedle =
    Boolean(needle) &&
    review.locations.slice(1).some(
      (loc) =>
        loc.quote.toLowerCase().includes(needle) ||
        loc.documentName.toLowerCase().includes(needle) ||
        String(loc.pageNumber ?? "").includes(needle),
    );
  const expanded = !collapse || open || hiddenNeedle;
  const shown = expanded ? review.locations : review.locations.slice(0, 1);
  const rest = review.locations.length - 1;
  const firstName = review.locations[0]?.documentName;

  return (
    <ul className="min-w-0 space-y-0.5">
      {shown.map((location, index) => (
        <li
          key={`${location.documentId}-${location.pageNumber}-${index}`}
          className="flex min-w-0 items-baseline gap-1"
        >
          {index > 0 ? (
            <span className="shrink-0 text-[10px] text-muted">↔</span>
          ) : null}
          <div className="min-w-0 flex-1">
            <LocationLine
              location={location}
              omitFile={index > 0 && location.documentName === firstName}
              needle={needle}
              wording={wording}
              reviewId={review.id}
              onJumpToPage={onJumpToPage}
            />
          </div>
        </li>
      ))}
      {collapse && !hiddenNeedle ? (
        <li>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((value) => !value);
            }}
            className="text-[10px] text-muted underline decoration-dotted hover:text-text"
          >
            {expanded ? "свернуть" : `ещё ${rest} ${ruPlaces(rest)}`}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

function ReviewRow({
  review,
  needle,
  active,
  selected,
  saving,
  lastEvent,
  onActivate,
  onToggleSelect,
  onPatch,
  onMarkWrong,
  onShowLog,
  onDelete,
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
  onActivate: () => void;
  onToggleSelect: () => void;
  onPatch: (body: Partial<Review>) => void;
  onMarkWrong: () => void;
  onShowLog: () => void;
  onDelete: () => void;
  onJumpToPage: (
    documentId: string,
    pageNumber: number,
    options?: { reviewId?: string; quote?: string; newTab?: boolean },
  ) => void;
}) {
  const [comment, setComment] = useState(review.comment);
  const commentRef = useRef(review.comment);
  /** Показываем «сохранено» пару секунд: иначе непонятно, ушла ли заметка. */
  const [savedFlash, setSavedFlash] = useState(false);

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
  }

  const wording = review.text || review.aiFinding;

  return (
    <tr
      onClick={onActivate}
      // Строка переезжает при смене важности и разбора — тестам нужна опора на id.
      data-review-id={review.id}
      className={`border-b border-slate-200 border-l-4 align-top ${
        SEVERITY_ROW[review.severity]
      } ${VERDICT_ROW[review.verdict] ?? ""} ${
        active
          ? "outline outline-2 -outline-offset-2 outline-accent ring-1 ring-inset ring-accent/20"
          : ""
      }`}
    >
      <td className="px-1 py-1.5">
        <input
          type="checkbox"
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onChange={onToggleSelect}
          aria-label={`Выбрать замечание ${review.number}`}
        />
      </td>
      <td className="px-2 py-1.5 tabular-nums text-muted">{review.number}</td>
      <td className="px-2 py-1.5">
        <span className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-text">
          {review.section}
        </span>
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-start gap-1.5">
          <span
            className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
              ORIGIN_CHIP[review.origin]
            }`}
            title={REVIEW_ORIGIN_LABEL[review.origin]}
          >
            {ORIGIN_SHORT[review.origin]}
          </span>
          <RemarkText
            wording={wording}
            needle={needle}
            aiFinding={review.text && review.aiFinding ? review.aiFinding : ""}
            wrongReason={review.wrongReason}
          />
        </div>
      </td>
      <td className="px-2 py-1.5">
        {review.needsRecheck ? (
          <div className="mb-1 text-[10px] font-medium text-amber-800">
            нужно перепроверить
          </div>
        ) : null}
        {review.locations.length === 0 ? (
          <span className="text-[11px] text-muted">
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
      <td className="px-2 py-1.5">
        <select
          value={review.severity}
          onChange={(event) =>
            onPatch({ severity: event.target.value as ReviewSeverity })
          }
          onClick={(event) => event.stopPropagation()}
          className={`w-full rounded border px-1.5 py-1 text-[11px] font-medium outline-none ${
            SEVERITY_CHIP[review.severity]
          }`}
        >
          {REVIEW_SEVERITY_ORDER.map((item) => (
            <option key={item} value={item}>
              {REVIEW_SEVERITY_LABEL[item]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <select
          value={review.verdict}
          onChange={(event) => {
            const next = event.target.value as ReviewVerdict;
            // «Неверно» ставится только через окно с причиной.
            if (next === "wrong") onMarkWrong();
            else onPatch({ verdict: next });
          }}
          onClick={(event) => event.stopPropagation()}
          className={`w-full rounded border px-1.5 py-1 text-[11px] font-medium outline-none ${
            VERDICT_CHIP[review.verdict]
          }`}
        >
          {VERDICTS.map((item) => (
            <option key={item} value={item}>
              {REVIEW_VERDICT_LABEL[item]}
            </option>
          ))}
        </select>
        {review.verdict === "wrong" ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onMarkWrong();
            }}
            className="mt-1 w-full rounded border border-rose-200 bg-white px-1 py-0.5 text-[10px] text-rose-800 hover:bg-rose-50"
          >
            Уточнить причину
          </button>
        ) : null}
      </td>
      <td className="px-2 py-1.5">
        <textarea
          value={comment}
          rows={2}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              commitComment();
            }
          }}
          onClick={(event) => event.stopPropagation()}
          placeholder="Заметка проверяющего"
          className={`w-full resize-y rounded border bg-white px-1.5 py-1 text-[11px] outline-none placeholder:text-muted focus:border-accent ${
            commentDirty ? "border-accent" : "border-slate-300"
          }`}
        />
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
                className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-[#1d4ed8]"
              >
                Сохранить
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setComment(review.comment);
                }}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-muted hover:text-text"
              >
                Отмена
              </button>
            </>
          ) : savedFlash ? (
            <span className="text-[10px] text-emerald-700">Сохранено</span>
          ) : lastEvent ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onShowLog();
              }}
              title="Журнал правок этого замечания"
              className="truncate text-[10px] text-muted underline decoration-dotted hover:text-text"
            >
              {`${REVIEW_EVENT_LABEL[lastEvent.field].toLowerCase()} · ${
                lastEvent.userName ?? "система"
              } · ${formatDate(lastEvent.at)}`}
            </button>
          ) : null}
        </div>
      </td>
      <td className="px-1 py-1.5 text-center">
        {saving ? (
          <Spinner className="h-3 w-3 text-accent" />
        ) : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            title="Удалить замечание"
            className="rounded px-1 text-[11px] leading-none text-muted hover:bg-red-50 hover:text-red-600"
          >
            ×
          </button>
        )}
      </td>
    </tr>
  );
}
