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
import { SegmentedTabs, Spinner } from "@/components/ui-chrome";
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
import { groupReviews, type GroupBy } from "@/lib/reviews-group";
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
  const [groupBy, setGroupBy] = useState<GroupBy>("section");
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

  const filtersOn =
    Object.keys(colFilters).length > 0 || query.trim().length > 0;

  const currentFileKey = useMemo(
    () => fileNameKey(currentDocumentName),
    [currentDocumentName],
  );

  const scoped = useMemo(() => {
    if (!currentDocumentId) return reviews;
    return reviews.filter((item) =>
      item.locations.some(
        (loc) =>
          loc.documentId === currentDocumentId ||
          (!loc.documentId && fileNameKey(loc.documentName) === currentFileKey),
      ),
    );
  }, [currentDocumentId, currentFileKey, reviews]);

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

  const groups = useMemo(() => groupReviews(sorted, groupBy), [
    groupBy,
    sorted,
  ]);

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

  const pendingEnrich = reviews.filter(
    (item) =>
      item.origin !== "ai" &&
      item.text &&
      (item.locations.length === 0 || item.needsRecheck),
  ).length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f4f6f9]">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-border px-2 py-1 text-[11px] text-muted hover:bg-bg hover:text-text"
          title="Вернуться к чертежам"
        >
          ← К чертежам
        </button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text">
            Замечания · {projectName}
          </div>
          <div className="text-[11px] tabular-nums text-muted">
            {loading
              ? "загрузка…"
              : `${stats.total} всего · ${stats.pending} не разобрано · ${stats.high} высокой важности · ${stats.exportable} в выгрузку`}
          </div>
          {loading ? null : (
            <div className="text-[11px] tabular-nums text-muted">
              {`нашла ИИ ${stats.ai} · инженеры ${stats.engineer} · ИИ и инженер ${stats.both}`}
              {stats.wrong ? (
                <span className="text-rose-700">
                  {` · брак ИИ ${stats.wrong}`}
                </span>
              ) : null}
            </div>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по замечаниям"
            className="w-44 rounded-md border border-border bg-white px-2 py-1 text-xs outline-none placeholder:text-muted focus:border-accent"
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
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            title="Загрузить замечания инженера из Excel"
          >
            {importing ? "Загрузка…" : "Загрузить Excel"}
          </button>
          <button
            type="button"
            disabled={enriching || pendingEnrich === 0}
            onClick={() => void handleEnrich()}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            title="Для строк из Excel без листа: проставить раздел, номер листа и цитату в колонке «Где в ПД»"
          >
            {enriching
              ? "Ищем места…"
              : pendingEnrich
                ? `Проставить, где в ПД · ${pendingEnrich}`
                : "Проставить, где в ПД"}
          </button>
          {visibleExportable.length === 0 ||
          (!filtersOn && reviews.some((item) => item.verdict === "pending")) ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-500"
              title={
                visibleExportable.length === 0
                  ? "Под текущий фильтр нечего выгружать"
                  : "Сначала проставьте важность и статус разбора у всех замечаний"
              }
            >
              <IconDownload className="h-3.5 w-3.5" />
              XLSX
            </span>
          ) : (
            <button
              type="button"
              disabled={exporting}
              onClick={() => void downloadVisibleXlsx()}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-50"
              title={
                filtersOn
                  ? `Скачать отфильтрованные: ${visibleExportable.length}`
                  : "Выгрузить наши и инженера одним файлом для проектировщиков"
              }
            >
              <IconDownload className="h-3.5 w-3.5" />
              {exporting
                ? "…"
                : filtersOn
                  ? `XLSX · ${visibleExportable.length}`
                  : "XLSX"}
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5">
        <SegmentedTabs
          size="xs"
          value={groupBy}
          onChange={setGroupBy}
          options={[
            { id: "section" as GroupBy, label: "По разделам" },
            { id: "file" as GroupBy, label: "По файлам" },
          ]}
        />
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
          const flat = groups.flatMap((group) => group.items);
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
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <tr>
                    <th
                      colSpan={9}
                      className="sticky top-8 z-[9] border-y border-slate-300 bg-slate-200/80 px-2 py-1 text-left text-[11px] font-semibold text-text"
                    >
                      {group.key}
                      <span className="ml-2 font-normal tabular-nums text-muted">
                        {group.items.length}
                      </span>
                    </th>
                  </tr>
                  {group.items.map((review) => (
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
          <div className="min-w-0 whitespace-pre-wrap leading-snug text-text">
            {highlight(wording, needle)}
          </div>
        </div>
        {review.text && review.aiFinding ? (
          <div className="mt-1 whitespace-pre-wrap border-l-2 border-violet-300 pl-2 text-[11px] leading-snug text-muted">
            Нашла ИИ: {highlight(review.aiFinding, needle)}
          </div>
        ) : null}
        {review.wrongReason ? (
          <div className="mt-1 whitespace-pre-wrap border-l-2 border-rose-400 pl-2 text-[11px] leading-snug text-rose-800">
            Неверно: {highlight(review.wrongReason, needle)}
          </div>
        ) : null}
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
          <ul className="space-y-1">
            {review.locations.map((location, index) => {
              const label = [
                location.documentName || "без раздела",
                location.pageNumber ? `стр. ${location.pageNumber}` : null,
              ]
                .filter(Boolean)
                .join(" · ");
              const jumpable = Boolean(location.documentId && location.pageNumber);
              return (
                <li key={`${location.documentId}-${location.pageNumber}-${index}`}>
                  {jumpable ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onJumpToPage(
                          location.documentId!,
                          location.pageNumber!,
                          {
                            reviewId: review.id,
                            quote: location.quote || wording || undefined,
                            newTab: event.ctrlKey || event.metaKey,
                          },
                        );
                      }}
                      onAuxClick={(event) => {
                        if (event.button !== 1) return;
                        event.preventDefault();
                        event.stopPropagation();
                        onJumpToPage(
                          location.documentId!,
                          location.pageNumber!,
                          {
                            reviewId: review.id,
                            quote: location.quote || wording || undefined,
                            newTab: true,
                          },
                        );
                      }}
                      title="Открыть на чертеже с подсветкой"
                      className="group w-full rounded-md border border-rose-200 bg-rose-50/80 px-1.5 py-1 text-left hover:border-rose-400 hover:bg-rose-100"
                    >
                      <span className="text-[11px] font-medium text-accent underline decoration-dotted group-hover:no-underline">
                        {highlight(label, needle)}
                      </span>
                      {location.quote ? (
                        <div className="mt-0.5 text-[10px] leading-snug text-rose-900">
                          «{highlight(location.quote, needle)}»
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[10px] text-muted">
                          Открыть лист · подсветить место
                        </div>
                      )}
                    </button>
                  ) : (
                    <>
                      <span className="text-[11px] font-medium text-text">
                        {highlight(label, needle)}
                      </span>
                      {location.quote ? (
                        <div className="text-[10px] leading-snug text-muted">
                          «{highlight(location.quote, needle)}»
                        </div>
                      ) : null}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
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
