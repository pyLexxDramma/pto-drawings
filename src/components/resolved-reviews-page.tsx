"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tooltip } from "@/components/tooltip";
import { VerdictDot } from "@/components/ui-chrome";
import {
  SEVERITY_CHIP,
  VERDICT_CHIP,
  VERDICT_ROW,
} from "@/lib/review-colors";
import {
  placeDeepLink,
  showPlaceInOpener,
  type PlacePayload,
} from "@/lib/place-bridge";
import { sheetLabel } from "@/lib/sheet-label";
import { RESOLVED_ORDER, resolvedCounts } from "@/components/resolved-summary";
import { IconDownload } from "@/components/tool-icons";
import {
  REVIEW_SEVERITY_LABEL,
  REVIEW_VERDICT_LABEL,
  type Project,
  type Review,
  type ReviewLocation,
  type ReviewSeverity,
  type ReviewVerdict,
} from "@/types";

/** Что значит каждый итог — инженер видит расшифровку, а не только кружок. */
/** Внутри блока сначала «Высокий», «не задана» — в хвост. */
const SEVERITY_RANK: Record<ReviewSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
  unset: 3,
  skip: 4,
};

const VERDICT_HINT: Record<ReviewVerdict, string> = {
  pending: "Ещё не разобрано",
  confirmed: "Расхождение подтверждено, идёт проектировщикам",
  partial: "Часть замечания верна — уточните формулировку",
  discuss: "Нужно обсудить с проектировщиком или заказчиком",
  outdated: "Снято на разборе, проектировщикам не идёт",
  wrong: "Ошибка конвейера: замечания нет, строка остаётся для разбора ИИ",
};

export function ResolvedReviewsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawProject = searchParams.get("project")?.trim();
  const projectId = rawProject ? rawProject : null;
  const [projectName, setProjectName] = useState("");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(Boolean(projectId));
  const [error, setError] = useState<string | null>(null);
  const [only, setOnly] = useState<ReviewVerdict | null>(null);
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  /** Место ушло в рабочую вкладку, но браузер не переключил её сам. */
  const [stuck, setStuck] = useState<PlacePayload | null>(null);

  /**
   * Возврат в рабочую вкладку: сообщение уходит всегда, а вот фокус браузер по
   * `focus()` переводит не всегда. Если фокус остался здесь — закрываем эту
   * вкладку, тогда браузер сам вернёт на рабочую. Не дали закрыть — показываем
   * подсказку с переходом на место здесь.
   */
  const showPlace = useCallback(
    (payload: PlacePayload) => {
      if (!showPlaceInOpener(payload)) {
        router.push(placeDeepLink(payload));
        return;
      }
      window.setTimeout(() => {
        if (!document.hasFocus()) return;
        window.close();
        window.setTimeout(() => setStuck(payload), 300);
      }, 250);
    },
    [router],
  );

  const backToWork = useCallback(() => {
    const opener = window.opener as Window | null;
    if (!opener || opener.closed) {
      router.push(`/?project=${encodeURIComponent(projectId ?? "")}`);
      return;
    }
    opener.focus();
    window.setTimeout(() => {
      if (document.hasFocus()) window.close();
    }, 250);
  }, [projectId, router]);

  const load = useCallback(async (id: string, signal?: AbortSignal) => {
    const [reviewsResponse, projectsResponse] = await Promise.all([
      fetch(`/api/projects/${id}/reviews`, { signal }),
      fetch("/api/projects", { signal }),
    ]);
    if (reviewsResponse.status === 401 || projectsResponse.status === 401) {
      throw new Error("Войдите в приложение в рабочей вкладке и обновите страницу");
    }
    if (!reviewsResponse.ok) throw new Error("Не удалось загрузить замечания");
    const reviewsPayload = (await reviewsResponse.json()) as { reviews?: Review[] };
    setReviews(reviewsPayload.reviews ?? []);
    if (projectsResponse.ok) {
      const payload = (await projectsResponse.json()) as { projects?: Project[] };
      setProjectName(payload.projects?.find((item) => item.id === id)?.name ?? "");
    }
  }, []);

  useEffect(() => {
    if (!projectId) return;
    // Проект берётся из адреса и не меняется, поэтому loading стартует с true.
    const controller = new AbortController();
    load(projectId, controller.signal)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Ошибка загрузки");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load, projectId]);

  const { counts, resolved, total } = useMemo(
    () => resolvedCounts(reviews),
    [reviews],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return reviews
      .filter((item) => item.verdict !== "pending" && item.severity !== "skip")
      .filter((item) => (only ? item.verdict === only : true))
      .filter((item) => {
        if (!needle) return true;
        return [
          item.text,
          item.aiFinding,
          item.comment,
          item.section,
          ...item.locations.map((loc) => `${loc.documentName} ${loc.quote}`),
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          a.number - b.number,
      );
  }, [only, query, reviews]);

  /** Блок на каждый итог разбора; внутри блока — самые важные сверху. */
  const groups = useMemo(
    () =>
      RESOLVED_ORDER.map((verdict) => ({
        verdict,
        items: rows.filter((item) => item.verdict === verdict),
      })).filter((group) => group.items.length > 0),
    [rows],
  );

  /**
   * Свой список из Excel ложится в общую таблицу замечаний со статусом
   * «Не разобрано», поэтому здесь строки появятся только после разбора.
   */
  async function handleImport(file: File) {
    if (!projectId) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/projects/${projectId}/reviews/import`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        added?: number;
        skipped?: number;
      };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось импортировать");
      await load(projectId);
      setError(null);
      const added = payload.added ?? 0;
      const skipped = payload.skipped ?? 0;
      setNote(
        added === 0
          ? `Новых строк нет: все ${skipped} уже были в таблице`
          : `Загружено строк: ${added}${skipped ? `, пропущено дублей: ${skipped}` : ""}. Они лежат в таблице замечаний со статусом «Не разобрано» — здесь появятся, когда поставите статус.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка импорта");
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  async function downloadXlsx() {
    if (!projectId || rows.length === 0) return;
    setExporting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/reviews/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewIds: rows.map((item) => item.id) }),
      });
      if (!response.ok) throw new Error("Не удалось выгрузить");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      const base = (projectName || "проект").replace(/[\\/:*?"<>|]/g, "").trim();
      link.href = url;
      link.download = `${base} — разобранные ${stamp}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка выгрузки");
    } finally {
      setExporting(false);
    }
  }

  if (!projectId) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg px-4 text-sm text-muted">
        Не указан проект. Откройте разобранные замечания из рабочей вкладки.
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-bg text-text">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 px-4 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">
              Разобранные замечания{projectName ? ` · ${projectName}` : ""}
            </h1>
            <div className="pto-t-md text-muted tabular-nums">
              Разобрано {resolved} из {total} · показано {rows.length}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <FilterChip
              active={only === null}
              label="Все"
              count={resolved}
              onClick={() => setOnly(null)}
            />
            {RESOLVED_ORDER.map((verdict) => (
              <FilterChip
                key={verdict}
                active={only === verdict}
                verdict={verdict}
                label={REVIEW_VERDICT_LABEL[verdict]}
                hint={VERDICT_HINT[verdict]}
                count={counts.get(verdict) ?? 0}
                onClick={() => setOnly(only === verdict ? null : verdict)}
              />
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по замечаниям"
              className="w-44 rounded-md border border-border bg-white px-2 py-1 pto-t-lg outline-none placeholder:text-muted focus:border-accent"
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
              className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 pto-t-lg font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              title="Загрузить свой список замечаний из файла Excel — строки уйдут в таблицу замечаний"
            >
              {importing ? "Загрузка…" : "Мои замечания из Excel"}
            </button>
            <button
              type="button"
              onClick={() => void downloadXlsx()}
              disabled={exporting || rows.length === 0}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-accent px-2 py-1 pto-t-lg font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-50"
              title={
                only || query.trim()
                  ? `Скачать то, что видно: ${rows.length}`
                  : "Скачать все разобранные замечания одним файлом Excel"
              }
            >
              <IconDownload className="h-3.5 w-3.5" />
              {exporting ? "Выгрузка…" : `Скачать Excel · ${rows.length}`}
            </button>
            <button
              type="button"
              onClick={backToWork}
              className="rounded-md border border-accent px-2 py-1 pto-t-lg font-medium text-accent hover:bg-blue-50"
              title="Вернуться в рабочую вкладку; если её закрыли — открыть проект здесь"
            >
              ← В рабочую вкладку
            </button>
          </div>
        </div>
      </header>

      {stuck ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 pto-t-lg text-amber-900">
          <span>
            Место открыто в рабочей вкладке — браузер не переключил её сам.
          </span>
          <button
            type="button"
            onClick={() => {
              setStuck(null);
              router.push(placeDeepLink(stuck));
            }}
            className="rounded-md border border-amber-400 bg-white px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100"
          >
            Открыть место здесь
          </button>
          <button
            type="button"
            onClick={() => setStuck(null)}
            className="text-amber-800 underline decoration-dotted"
          >
            скрыть
          </button>
        </div>
      ) : null}

      {note ? (
        <div className="flex items-start gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2 pto-t-lg text-emerald-900">
          <span className="min-w-0 flex-1">{note}</span>
          <button
            type="button"
            onClick={() => setNote(null)}
            className="shrink-0 text-emerald-800 underline decoration-dotted"
          >
            скрыть
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 pto-t-lg text-red-900">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="px-4 py-6 text-sm text-muted">Загрузка…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted">
          Разобранных замечаний нет. Поставьте статус в таблице замечаний —
          строка появится здесь.
        </div>
      ) : (
        <div className="px-4 py-3">
          <table className="w-full border-separate border-spacing-0 pto-t-lg">
            <thead className="text-left pto-t-md text-muted">
              <tr>
                <Th className="w-12">№</Th>
                <Th className="w-28">Раздел</Th>
                <Th>Замечание</Th>
                <Th className="w-72">Где в ПД</Th>
                <Th className="w-40">Итог разбора</Th>
                <Th className="w-24">Важность</Th>
                <Th className="w-56">Комментарий</Th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.verdict}>
              <tr>
                <td colSpan={7} className="px-2 pb-1 pt-3">
                  <div className="flex items-center gap-2 border-b border-border pb-1">
                    <VerdictDot verdict={group.verdict} className="h-3 w-3" />
                    <span className="pto-t-lg font-semibold text-text">
                      {REVIEW_VERDICT_LABEL[group.verdict]}
                    </span>
                    <span className="pto-t-md text-muted tabular-nums">
                      {group.items.length}
                    </span>
                    <span className="pto-t-md text-muted">
                      · {VERDICT_HINT[group.verdict]} · сверху самые важные
                    </span>
                  </div>
                </td>
              </tr>
              {group.items.map((review) => (
                <tr
                  key={review.id}
                  className={`align-top ${VERDICT_ROW[review.verdict] ?? ""}`}
                >
                  <Td className="tabular-nums text-muted">{review.number}</Td>
                  <Td className="text-muted">{review.section || "—"}</Td>
                  <Td>
                    <div className="whitespace-pre-wrap leading-snug">
                      {review.text}
                    </div>
                    {review.aiFinding ? (
                      <div className="mt-1 whitespace-pre-wrap border-l-2 border-slate-300 pl-2 pto-t-md leading-snug text-muted">
                        Нашла ИИ: {review.aiFinding}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <div className="space-y-0.5">
                      {review.locations.length === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        review.locations.map((location, index) => (
                          <PlaceLink
                            key={`${review.id}-${index}`}
                            projectId={projectId}
                            reviewId={review.id}
                            wording={review.text}
                            location={location}
                            onShowPlace={showPlace}
                          />
                        ))
                      )}
                    </div>
                  </Td>
                  <Td>
                    <VerdictBadge verdict={review.verdict} />
                    {review.wrongReason ? (
                      <div className="mt-1 whitespace-pre-wrap pto-t-md leading-snug text-rose-800">
                        {review.wrongReason}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <span
                      className={`inline-flex rounded border px-1.5 py-0.5 pto-t-md ${SEVERITY_CHIP[review.severity]}`}
                      title={`Важность: ${REVIEW_SEVERITY_LABEL[review.severity]}`}
                    >
                      {REVIEW_SEVERITY_LABEL[review.severity]}
                    </span>
                  </Td>
                  <Td className="whitespace-pre-wrap leading-snug text-muted">
                    {review.comment || "—"}
                  </Td>
                </tr>
              ))}
              </tbody>
            ))}
          </table>

          <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2 pto-t-md text-muted">
            <div className="mb-1 font-medium text-text">Что значат кружки</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {RESOLVED_ORDER.map((verdict) => (
                <span key={verdict} className="inline-flex items-center gap-1.5">
                  <VerdictDot verdict={verdict} className="h-2.5 w-2.5" />
                  <span className="text-text">{REVIEW_VERDICT_LABEL[verdict]}</span>
                  <span>— {VERDICT_HINT[verdict]}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/** Кружок + число: клик оставляет в таблице только этот итог разбора. */
function FilterChip({
  active,
  verdict,
  label,
  hint,
  count,
  onClick,
}: {
  active: boolean;
  verdict?: ReviewVerdict;
  label: string;
  hint?: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint ?? "Показать все разобранные"}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 pto-t-md ${
        active
          ? "border-accent bg-blue-50 font-medium text-text"
          : "border-border bg-white text-muted hover:text-text"
      }`}
    >
      {verdict ? (
        <VerdictDot verdict={verdict} className="h-2.5 w-2.5" />
      ) : null}
      <span>{label}</span>
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`sticky top-[3.25rem] z-10 border-b border-border bg-bg px-2 py-1 font-medium ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`border-b border-border px-2 py-1.5 ${className}`}>
      {children}
    </td>
  );
}

/** Кружок с подписью: сам итог виден всегда, расшифровка — по наведению. */
function VerdictBadge({ verdict }: { verdict: ReviewVerdict }) {
  return (
    <Tooltip label={VERDICT_HINT[verdict]}>
      <span
        className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 pto-t-md ${VERDICT_CHIP[verdict]}`}
      >
        <VerdictDot verdict={verdict} className="h-2.5 w-2.5" />
        {REVIEW_VERDICT_LABEL[verdict]}
      </span>
    </Tooltip>
  );
}

/**
 * Клик возвращает в рабочую вкладку и показывает место там; если её закрыли —
 * место открывается здесь.
 */
function PlaceLink({
  projectId,
  reviewId,
  wording,
  location,
  onShowPlace,
}: {
  projectId: string;
  reviewId: string;
  wording: string;
  location: ReviewLocation;
  onShowPlace: (payload: PlacePayload) => void;
}) {
  const head = [location.documentName || "без раздела", sheetLabel(location)]
    .filter(Boolean)
    .join(" · ");
  const jumpable = Boolean(location.documentId && location.pageNumber);
  const title = [head, location.quote ? `«${location.quote}»` : null]
    .filter(Boolean)
    .join(" · ");

  if (!jumpable) {
    return (
      <div className="truncate pto-t-md leading-snug" title={title}>
        <span className="font-medium">{head || "без места"}</span>
        {location.quote ? <span> · «{location.quote}»</span> : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      title={`Показать в рабочей вкладке: ${title}`}
      onClick={() =>
        onShowPlace({
          projectId,
          documentId: location.documentId!,
          page: location.pageNumber!,
          reviewId,
          quote: location.quote || wording || undefined,
        })
      }
      className="block max-w-full truncate rounded px-0.5 -mx-0.5 text-left pto-t-md leading-snug text-accent hover:bg-blue-50"
    >
      <span className="font-medium underline decoration-dotted">
        {head || "открыть лист"}
      </span>
      {location.quote ? <span> · «{location.quote}»</span> : null}
    </button>
  );
}
