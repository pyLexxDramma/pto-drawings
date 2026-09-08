"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SegmentedTabs, Spinner } from "@/components/ui-chrome";
import { IconDownload } from "@/components/tool-icons";
import { groupReviews, type GroupBy } from "@/lib/reviews-group";
import {
  REVIEW_ORIGIN_LABEL,
  REVIEW_SEVERITY_LABEL,
  REVIEW_SEVERITY_ORDER,
  REVIEW_VERDICT_LABEL,
  type Review,
  type ReviewOrigin,
  type ReviewSeverity,
  type ReviewVerdict,
} from "@/types";

/** Разделы ПД для формы нового замечания. */
const SECTIONS = [
  "ПЗ",
  "ПЗУ",
  "АР1",
  "АР2",
  "АР3",
  "АР4",
  "АР5",
  "КР1",
  "КР2",
  "КР3",
  "КР4",
  "ИОС1",
  "ИОС2",
  "ИОС3",
  "ИОС4",
  "ИОС5",
  "ПОС",
  "ПБ",
  "ТБЭ",
  "ОДИ",
  "межраздел",
];

const SEVERITY_ROW: Record<ReviewSeverity, string> = {
  high: "border-l-red-500 bg-red-50/60",
  medium: "border-l-amber-400 bg-amber-50/50",
  low: "border-l-emerald-400 bg-emerald-50/40",
  skip: "border-l-slate-300 bg-slate-50 opacity-60",
};

const SEVERITY_CHIP: Record<ReviewSeverity, string> = {
  high: "border-red-300 bg-red-100 text-red-900",
  medium: "border-amber-300 bg-amber-100 text-amber-900",
  low: "border-emerald-300 bg-emerald-100 text-emerald-900",
  skip: "border-slate-300 bg-slate-100 text-slate-600",
};

const VERDICT_CHIP: Record<ReviewVerdict, string> = {
  pending: "border-slate-300 bg-white text-muted",
  confirmed: "border-emerald-300 bg-emerald-50 text-emerald-900",
  partial: "border-amber-300 bg-amber-50 text-amber-900",
  discuss: "border-sky-300 bg-sky-50 text-sky-900",
  outdated: "border-slate-300 bg-slate-100 text-slate-500 line-through",
};

const VERDICTS: ReviewVerdict[] = [
  "pending",
  "confirmed",
  "partial",
  "discuss",
  "outdated",
];

type SeverityFilter = "all" | ReviewSeverity;
type VerdictFilter = "all" | "pending" | "done";
type OriginFilter = "all" | ReviewOrigin;

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
 * Компактный фильтр вместо ряда вкладок: над таблицей их четыре, вкладками
 * они занимали всю полосу и мешали читать сами замечания.
 */
function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { id: T; label: string }[];
}) {
  const active = value !== "all";
  return (
    <label
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${
        active
          ? "border-accent/60 bg-accent/5 text-text"
          : "border-border bg-white text-muted"
      }`}
    >
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="max-w-[8rem] bg-transparent text-[11px] font-medium text-text outline-none"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ReviewsTable({
  projectId,
  projectName,
  onJumpToPage,
  onStatsChange,
  onClose,
}: {
  projectId: string;
  projectName: string;
  /** Открыть место в ПД в просмотрщике. */
  onJumpToPage: (documentId: string, pageNumber: number) => void;
  /** Держит счётчик этапа «Замечания» в панели проекта в согласии с таблицей. */
  onStatsChange?: (stats: { total: number; pending: number }) => void;
  onClose: () => void;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("all");
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("section");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [draftSection, setDraftSection] = useState("ПЗ");
  const [draftText, setDraftText] = useState("");
  const [draftSeverity, setDraftSeverity] = useState<ReviewSeverity>("medium");
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
      const payload = (await response.json()) as { reviews: Review[] };
      setReviews(payload.reviews ?? []);
    },
    [projectId],
  );

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

  const sections = useMemo(() => {
    const seen: string[] = [];
    for (const item of reviews) {
      if (!seen.includes(item.section)) seen.push(item.section);
    }
    return seen;
  }, [reviews]);

  const filtersOn =
    severityFilter !== "all" ||
    verdictFilter !== "all" ||
    originFilter !== "all" ||
    sectionFilter !== "all" ||
    query.trim().length > 0;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return reviews.filter((item) => {
      if (severityFilter !== "all" && item.severity !== severityFilter) {
        return false;
      }
      if (verdictFilter === "pending" && item.verdict !== "pending") return false;
      if (verdictFilter === "done" && item.verdict === "pending") return false;
      if (originFilter !== "all" && item.origin !== originFilter) return false;
      if (sectionFilter !== "all" && item.section !== sectionFilter) return false;
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
  }, [
    originFilter,
    query,
    reviews,
    sectionFilter,
    severityFilter,
    verdictFilter,
  ]);

  /** Разбор идёт построчно, поэтому счётчик «сколько осталось» всегда на виду. */
  const stats = useMemo(() => {
    const total = reviews.length;
    const pending = reviews.filter((item) => item.verdict === "pending").length;
    const exportable = reviews.filter((item) => item.severity !== "skip").length;
    const high = reviews.filter((item) => item.severity === "high").length;
    const ai = reviews.filter((item) => item.origin === "ai").length;
    const engineer = reviews.filter((item) => item.origin === "engineer").length;
    const both = reviews.filter((item) => item.origin === "both").length;
    return {
      total,
      pending,
      done: total - pending,
      exportable,
      high,
      ai,
      engineer,
      both,
    };
  }, [reviews]);

  useEffect(() => {
    onStatsChange?.({ total: stats.total, pending: stats.pending });
  }, [onStatsChange, stats.pending, stats.total]);

  const groups = useMemo(() => groupReviews(visible, groupBy), [
    groupBy,
    visible,
  ]);

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
        if (!response.ok) throw new Error("Не удалось сохранить");
        const payload = (await response.json()) as { review: Review };
        setReviews((prev) =>
          prev.map((item) =>
            item.id === reviewId ? payload.review : item,
          ),
        );
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка сохранения");
        await load().catch(() => undefined);
      } finally {
        setSavingId(null);
      }
    },
    [load, projectId],
  );

  async function handleAdd() {
    const text = draftText.trim();
    if (!text) return;
    setAdding(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: draftSection,
          text,
          severity: draftSeverity,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Не удалось добавить");
      }
      setDraftText("");
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка добавления");
    } finally {
      setAdding(false);
    }
  }

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления");
    } finally {
      setSavingId(null);
    }
  }

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
              {`нашла ИИ ${stats.ai} · инженеры ${stats.engineer} · совпало ${stats.both}`}
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
          <a
            href={`/api/projects/${projectId}/reviews/export`}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1d4ed8]"
            title="Выгрузить XLSX для проектировщиков"
          >
            <IconDownload className="h-3.5 w-3.5" />
            XLSX
          </a>
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
        <FilterSelect
          label="Важность"
          value={severityFilter}
          onChange={setSeverityFilter}
          options={[
            { id: "all" as SeverityFilter, label: "любая" },
            ...REVIEW_SEVERITY_ORDER.map((item) => ({
              id: item as SeverityFilter,
              label: REVIEW_SEVERITY_LABEL[item].toLowerCase(),
            })),
          ]}
        />
        <FilterSelect
          label="Разбор"
          value={verdictFilter}
          onChange={setVerdictFilter}
          options={[
            { id: "all" as VerdictFilter, label: "любой" },
            { id: "pending" as VerdictFilter, label: "не разобрано" },
            { id: "done" as VerdictFilter, label: "разобрано" },
          ]}
        />
        <FilterSelect
          label="Поток"
          value={originFilter}
          onChange={setOriginFilter}
          options={[
            { id: "all" as OriginFilter, label: "оба" },
            {
              id: "ai" as OriginFilter,
              label: "нашла ИИ",
            },
            {
              id: "engineer" as OriginFilter,
              label: "инженер",
            },
            {
              id: "both" as OriginFilter,
              label: "совпало",
            },
          ]}
        />
        {sections.length > 1 ? (
          <FilterSelect
            label="Раздел"
            value={sectionFilter}
            onChange={setSectionFilter}
            options={[
              { id: "all", label: "все" },
              ...sections.map((section) => ({ id: section, label: section })),
            ]}
          />
        ) : null}
        {filtersOn ? (
          <button
            type="button"
            onClick={() => {
              setSeverityFilter("all");
              setVerdictFilter("all");
              setOriginFilter("all");
              setSectionFilter("all");
              setQuery("");
            }}
            className="rounded-md border border-border bg-white px-2 py-1 text-[11px] text-muted hover:text-text"
            title="Показать все замечания"
          >
            Сбросить
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

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-muted">
            <Spinner /> Загружаем замечания
          </div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center text-xs text-muted">
            {reviews.length === 0
              ? "Замечаний пока нет — конвейер их ещё не присылал. Можно добавить своё ниже."
              : "Под фильтры ничего не попало."}
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 text-left text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="w-10 border-b border-border px-2 py-1.5 font-medium">№</th>
                <th className="w-16 border-b border-border px-2 py-1.5 font-medium">
                  Раздел
                </th>
                <th className="border-b border-border px-2 py-1.5 font-medium">
                  Замечание
                </th>
                <th className="w-64 border-b border-border px-2 py-1.5 font-medium">
                  Где в ПД
                </th>
                <th className="w-28 border-b border-border px-2 py-1.5 font-medium">
                  Важность
                </th>
                <th className="w-32 border-b border-border px-2 py-1.5 font-medium">
                  Разбор
                </th>
                <th className="w-48 border-b border-border px-2 py-1.5 font-medium">
                  Комментарий
                </th>
                <th className="w-8 border-b border-border px-1 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <tr>
                    <th
                      colSpan={8}
                      className="border-y border-slate-300 bg-slate-200/80 px-2 py-1 text-left text-[11px] font-semibold text-text"
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
                      active={activeId === review.id}
                      saving={savingId === review.id}
                      onActivate={() => setActiveId(review.id)}
                      onPatch={(body) => void patch(review.id, body)}
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

      <footer className="border-t border-border bg-surface px-3 py-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-muted">
              Раздел
            </span>
            <select
              value={draftSection}
              onChange={(event) => setDraftSection(event.target.value)}
              className="rounded-md border border-border bg-white px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              {SECTIONS.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-muted">
              Своё замечание
            </span>
            <input
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleAdd();
              }}
              placeholder="Например: площадь застройки КПП не сходится с ведомостью"
              className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs outline-none placeholder:text-muted focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-muted">
              Важность
            </span>
            <select
              value={draftSeverity}
              onChange={(event) =>
                setDraftSeverity(event.target.value as ReviewSeverity)
              }
              className="rounded-md border border-border bg-white px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              {REVIEW_SEVERITY_ORDER.map((item) => (
                <option key={item} value={item}>
                  {REVIEW_SEVERITY_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={adding || draftText.trim().length === 0}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-text hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {adding ? "Добавляем…" : "Добавить"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function ReviewRow({
  review,
  active,
  saving,
  onActivate,
  onPatch,
  onDelete,
  onJumpToPage,
}: {
  review: Review;
  active: boolean;
  saving: boolean;
  onActivate: () => void;
  onPatch: (body: Partial<Review>) => void;
  onDelete: () => void;
  onJumpToPage: (documentId: string, pageNumber: number) => void;
}) {
  const [comment, setComment] = useState(review.comment);
  const commentRef = useRef(review.comment);

  // Правку с сервера подхватываем, набранный текст не сбрасываем.
  useEffect(() => {
    if (review.comment !== commentRef.current) {
      commentRef.current = review.comment;
      setComment(review.comment);
    }
  }, [review.comment]);

  function commitComment() {
    const next = comment.trim();
    if (next === review.comment) return;
    commentRef.current = next;
    onPatch({ comment: next });
  }

  const wording = review.text || review.aiFinding;

  return (
    <tr
      onClick={onActivate}
      className={`border-b border-slate-200 border-l-4 align-top ${
        SEVERITY_ROW[review.severity]
      } ${active ? "outline outline-1 -outline-offset-1 outline-accent/50" : ""}`}
    >
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
            {wording}
          </div>
        </div>
        {review.text && review.aiFinding ? (
          <div className="mt-1 whitespace-pre-wrap border-l-2 border-violet-300 pl-2 text-[11px] leading-snug text-muted">
            Нашла ИИ: {review.aiFinding}
          </div>
        ) : null}
      </td>
      <td className="px-2 py-1.5">
        {review.locations.length === 0 ? (
          <span className="text-[11px] text-muted">—</span>
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
                        onJumpToPage(location.documentId!, location.pageNumber!);
                      }}
                      className="text-left text-[11px] font-medium text-accent underline decoration-dotted hover:no-underline"
                    >
                      {label}
                    </button>
                  ) : (
                    <span className="text-[11px] font-medium text-text">{label}</span>
                  )}
                  {location.quote ? (
                    <div className="text-[10px] leading-snug text-muted">
                      «{location.quote}»
                    </div>
                  ) : null}
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
          onChange={(event) =>
            onPatch({ verdict: event.target.value as ReviewVerdict })
          }
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
      </td>
      <td className="px-2 py-1.5">
        <textarea
          value={comment}
          rows={2}
          onChange={(event) => setComment(event.target.value)}
          onBlur={commitComment}
          onClick={(event) => event.stopPropagation()}
          placeholder="Заметка проверяющего"
          className="w-full resize-y rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px] outline-none placeholder:text-muted focus:border-accent"
        />
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
