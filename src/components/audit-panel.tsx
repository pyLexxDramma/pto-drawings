"use client";

import { useCallback, useEffect, useState } from "react";
import { SegmentedTabs } from "@/components/ui-chrome";
import { formatBytes, formatDate } from "@/lib/format";
import {
  REVIEW_EVENT_LABEL,
  REVIEW_SEVERITY_LABEL,
  REVIEW_VERDICT_LABEL,
  type ReviewEvent,
  type ReviewSeverity,
  type ReviewVerdict,
} from "@/types";

/**
 * Журналы правок для админа: кто и что менял. Отдельная вкладка «Обновления
 * прода» — для разработчика: что выкатили, включая слитые ветки коллег.
 */

type Tab = "reviews" | "edits" | "marks" | "files" | "releases";

const TABS: { id: Tab; label: string }[] = [
  { id: "reviews", label: "Замечания" },
  { id: "edits", label: "Правки текста" },
  { id: "marks", label: "Ошибки на чертежах" },
  { id: "files", label: "Файлы" },
  { id: "releases", label: "Обновления прода" },
];

const HINT: Record<Tab, string> = {
  reviews: "Правки в таблице замечаний: важность, разбор, комментарий, текст.",
  edits: "Правки расшифровки листов (сейчас закрыты — остаётся история).",
  marks: "Отметки «Ошибка» на чертежах: что обвели и что должно быть.",
  files: "Загрузки файлов: кто, когда, каким конвейером расшифровали.",
  releases:
    "Что выкатили на прод: main — то, что работает сейчас; ветки коллег — что ещё ждёт слияния.",
};

type ReviewRow = ReviewEvent & {
  project: string;
  reviewNumber: number | null;
  section: string | null;
};
type EditRow = {
  at: string;
  project: string;
  name: string;
  pageNumber: number;
  userName: string | null;
};
type MarkRow = EditRow & {
  status: string;
  comment: string;
  expected: string;
  resolvedAt: string | null;
};
type FileRow = {
  at: string;
  project: string;
  name: string;
  sizeBytes: number;
  pages: number;
  status: string;
  pipelineMode: string | null;
  pipelineModel: string | null;
  elapsedSec: number | null;
  userName: string | null;
};
type Repo = "front" | "pipeline";
type Commit = {
  repo: Repo;
  sha: string;
  shortSha: string;
  author: string;
  at: string;
  subject: string;
  merge: boolean;
};
type Start = { sha: string; shortSha: string; at: string; version: string | null };
type Branch = {
  repo: Repo;
  branch: string;
  shortSha: string;
  author: string;
  at: string;
  subject: string;
  merged: boolean;
};

type Payload = {
  rows?: unknown[];
  commits?: Commit[];
  starts?: Start[];
  branches?: Branch[];
  sources?: { repo: Repo; label: string; dir: string }[];
  error?: string;
};

const REPO_LABEL: Record<Repo, string> = {
  front: "Фронт",
  pipeline: "Конвейер",
};

const REPO_CHIP: Record<Repo, string> = {
  front: "border-sky-200 bg-sky-50 text-sky-900",
  pipeline: "border-violet-200 bg-violet-50 text-violet-900",
};

function RepoChip({ repo }: { repo: Repo }) {
  return (
    <span
      className={`whitespace-nowrap rounded border px-1 py-0.5 text-[9px] uppercase ${REPO_CHIP[repo]}`}
    >
      {REPO_LABEL[repo]}
    </span>
  );
}

const MARK_STATUS: Record<string, string> = {
  open: "открыта",
  resolved: "исправлена",
  rejected: "отклонена",
};

function severityLabel(value: string | null): string {
  if (!value) return "—";
  return REVIEW_SEVERITY_LABEL[value as ReviewSeverity] ?? value;
}

function verdictLabel(value: string | null): string {
  if (!value) return "—";
  // Причина брака дописана к вердикту через двоеточие: «wrong: такого нет».
  const [code, ...rest] = value.split(": ");
  const label = REVIEW_VERDICT_LABEL[code as ReviewVerdict];
  if (!label) return value;
  return rest.length ? `${label} · ${rest.join(": ")}` : label;
}

/** Для severity и verdict показываем человеческие названия, для текста — как есть. */
function eventValue(field: ReviewEvent["field"], value: string | null): string {
  if (field === "severity") return severityLabel(value);
  if (field === "verdict") return verdictLabel(value);
  if (!value) return "—";
  return value.length > 90 ? `${value.slice(0, 90)}…` : value;
}

const cell = "px-2 py-1.5 align-top";
const head = "px-2 py-1.5 text-left font-medium";

export function AuditPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("reviews");
  // Ответ и ошибку держим вместе с разделом: пока пришёл ответ прошлой вкладки,
  // показываем «Читаем…», а не чужие строки.
  const [result, setResult] = useState<{ tab: Tab; payload: Payload } | null>(null);
  const [failure, setFailure] = useState<{ tab: Tab; message: string } | null>(null);

  const load = useCallback(async (kind: Tab, signal: AbortSignal) => {
    try {
      const response = await fetch(`/api/audit?kind=${kind}`, { signal });
      const data = (await response.json()) as Payload;
      if (!response.ok) throw new Error(data.error || "Не удалось прочитать журнал");
      setResult({ tab: kind, payload: data });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setFailure({
        tab: kind,
        message: err instanceof Error ? err.message : "Не удалось прочитать журнал",
      });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    void (async () => {
      if (ac.signal.aborted) return;
      await load(tab, ac.signal);
    })();
    return () => ac.abort();
  }, [load, open, tab]);

  if (!open) return null;

  const payload = result?.tab === tab ? result.payload : null;
  const error = failure?.tab === tab ? failure.message : null;
  const busy = !payload && !error;
  const rows = (payload?.rows ?? []) as unknown[];
  const empty = !busy && !error && tab !== "releases" && rows.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Журналы правок"
      onClick={onClose}
    >
      <div
        className="mt-6 flex max-h-[88dvh] w-full max-w-5xl flex-col rounded-xl border border-border bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-text">Журналы правок</div>
            <div className="text-[11px] text-muted">{HINT[tab]}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-text"
          >
            Закрыть
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <SegmentedTabs
            size="xs"
            value={tab}
            onChange={(value) => setTab(value as Tab)}
            options={TABS}
          />
          {busy ? <span className="text-[11px] text-muted">Читаем…</span> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {error ? (
            <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          ) : null}
          {empty ? (
            <div className="py-6 text-center text-xs text-muted">Записей пока нет.</div>
          ) : null}

          {tab === "reviews" && rows.length ? (
            <table className="w-full border-collapse text-[11px]">
              <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className={head}>Когда</th>
                  <th className={head}>Кто</th>
                  <th className={head}>Проект</th>
                  <th className={head}>Замечание</th>
                  <th className={head}>Что</th>
                  <th className={head}>Было</th>
                  <th className={head}>Стало</th>
                </tr>
              </thead>
              <tbody>
                {(rows as ReviewRow[]).map((row) => (
                  <tr key={row.id} className="border-b border-slate-200">
                    <td className={`${cell} whitespace-nowrap text-muted`}>{formatDate(row.at)}</td>
                    <td className={cell}>{row.userName ?? "—"}</td>
                    <td className={`${cell} text-muted`}>{row.project}</td>
                    <td className={`${cell} whitespace-nowrap text-muted`}>
                      {row.reviewNumber ? `№${row.reviewNumber}` : "удалено"}
                      {row.section ? ` · ${row.section}` : ""}
                    </td>
                    <td className={cell}>{REVIEW_EVENT_LABEL[row.field]}</td>
                    <td className={`${cell} text-muted`}>{eventValue(row.field, row.from)}</td>
                    <td className={cell}>{eventValue(row.field, row.to)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {tab === "edits" && rows.length ? (
            <table className="w-full border-collapse text-[11px]">
              <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className={head}>Когда</th>
                  <th className={head}>Кто</th>
                  <th className={head}>Проект</th>
                  <th className={head}>Файл</th>
                  <th className={head}>Лист</th>
                </tr>
              </thead>
              <tbody>
                {(rows as EditRow[]).map((row, index) => (
                  <tr key={`${row.at}-${index}`} className="border-b border-slate-200">
                    <td className={`${cell} whitespace-nowrap text-muted`}>{formatDate(row.at)}</td>
                    <td className={cell}>{row.userName ?? "—"}</td>
                    <td className={`${cell} text-muted`}>{row.project}</td>
                    <td className={cell}>{row.name}</td>
                    <td className={`${cell} tabular-nums`}>{row.pageNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {tab === "marks" && rows.length ? (
            <table className="w-full border-collapse text-[11px]">
              <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className={head}>Когда</th>
                  <th className={head}>Кто</th>
                  <th className={head}>Проект</th>
                  <th className={head}>Файл</th>
                  <th className={head}>Лист</th>
                  <th className={head}>Что не так</th>
                  <th className={head}>Должно быть</th>
                  <th className={head}>Статус</th>
                </tr>
              </thead>
              <tbody>
                {(rows as MarkRow[]).map((row, index) => (
                  <tr key={`${row.at}-${index}`} className="border-b border-slate-200">
                    <td className={`${cell} whitespace-nowrap text-muted`}>{formatDate(row.at)}</td>
                    <td className={cell}>{row.userName ?? "—"}</td>
                    <td className={`${cell} text-muted`}>{row.project}</td>
                    <td className={cell}>{row.name}</td>
                    <td className={`${cell} tabular-nums`}>{row.pageNumber}</td>
                    <td className={cell}>{row.comment || "—"}</td>
                    <td className={cell}>{row.expected || "—"}</td>
                    <td className={`${cell} whitespace-nowrap text-muted`}>
                      {MARK_STATUS[row.status] ?? row.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {tab === "files" && rows.length ? (
            <table className="w-full border-collapse text-[11px]">
              <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className={head}>Когда</th>
                  <th className={head}>Кто загрузил</th>
                  <th className={head}>Проект</th>
                  <th className={head}>Файл</th>
                  <th className={head}>Размер</th>
                  <th className={head}>Листов</th>
                  <th className={head}>Конвейер</th>
                </tr>
              </thead>
              <tbody>
                {(rows as FileRow[]).map((row, index) => (
                  <tr key={`${row.at}-${index}`} className="border-b border-slate-200">
                    <td className={`${cell} whitespace-nowrap text-muted`}>{formatDate(row.at)}</td>
                    <td className={cell}>{row.userName ?? "—"}</td>
                    <td className={`${cell} text-muted`}>{row.project}</td>
                    <td className={cell}>{row.name}</td>
                    <td className={`${cell} whitespace-nowrap tabular-nums text-muted`}>
                      {formatBytes(row.sizeBytes)}
                    </td>
                    <td className={`${cell} tabular-nums`}>{row.pages || "—"}</td>
                    <td className={`${cell} text-muted`}>
                      {[row.pipelineMode, row.pipelineModel].filter(Boolean).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {tab === "releases" ? (
            <div className="space-y-4">
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Запуски приложения после обновления
                </div>
                {payload?.starts?.length ? (
                  <table className="w-full border-collapse text-[11px]">
                    <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-muted">
                      <tr>
                        <th className={head}>Когда</th>
                        <th className={head}>Коммит</th>
                        <th className={head}>Версия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.starts.map((row) => (
                        <tr key={`${row.sha}-${row.at}`} className="border-b border-slate-200">
                          <td className={`${cell} whitespace-nowrap text-muted`}>
                            {formatDate(row.at)}
                          </td>
                          <td className={`${cell} font-mono`}>{row.shortSha}</td>
                          <td className={`${cell} text-muted`}>{row.version ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-xs text-muted">
                    Отметок пока нет — появятся при следующем обновлении.
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Ветки коллег
                </div>
                <div className="mb-1 text-[11px] text-muted">
                  Состояние на момент последнего деплоя: прод подтягивает все ветки, но выкатывает
                  только main. «Слита» — код уже на проде.
                </div>
                {payload?.sources && !payload.sources.some((item) => item.repo === "pipeline") ? (
                  <div className="mb-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                    Копия конвейера рядом не найдена — видны только правки фронта. Путь к ней
                    задаётся переменной PTO_PIPELINE_REPO.
                  </div>
                ) : null}
                {payload?.branches?.length ? (
                  <table className="w-full border-collapse text-[11px]">
                    <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-muted">
                      <tr>
                        <th className={head}>Где</th>
                        <th className={head}>Ветка</th>
                        <th className={head}>Автор</th>
                        <th className={head}>Когда</th>
                        <th className={head}>Коммит</th>
                        <th className={head}>Что сделано</th>
                        <th className={head}>Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.branches.map((row) => (
                        <tr key={`${row.repo}-${row.branch}`} className="border-b border-slate-200">
                          <td className={cell}>
                            <RepoChip repo={row.repo} />
                          </td>
                          <td className={`${cell} font-medium`}>{row.branch}</td>
                          <td className={`${cell} whitespace-nowrap`}>{row.author}</td>
                          <td className={`${cell} whitespace-nowrap text-muted`}>
                            {row.at ? formatDate(row.at) : "—"}
                          </td>
                          <td className={`${cell} font-mono`}>{row.shortSha}</td>
                          <td className={cell}>{row.subject}</td>
                          <td className={`${cell} whitespace-nowrap`}>
                            {row.merged ? (
                              <span className="text-emerald-700">слита</span>
                            ) : (
                              <span className="text-amber-700">не выкачена</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-xs text-muted">
                    Кроме main ветвей нет — вся работа идёт напрямую в main.
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Коммиты в main
                </div>
                <div className="mb-1 text-[11px] text-muted">
                  Фронт и конвейер вместе: правки коллеги по ИИ лежат в репозитории конвейера, в
                  истории фронта их не видно.
                </div>
                {payload?.commits?.length ? (
                  <table className="w-full border-collapse text-[11px]">
                    <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-muted">
                      <tr>
                        <th className={head}>Где</th>
                        <th className={head}>Когда</th>
                        <th className={head}>Автор</th>
                        <th className={head}>Коммит</th>
                        <th className={head}>Что сделано</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.commits.map((row) => (
                        <tr key={`${row.repo}-${row.sha}`} className="border-b border-slate-200">
                          <td className={cell}>
                            <RepoChip repo={row.repo} />
                          </td>
                          <td className={`${cell} whitespace-nowrap text-muted`}>
                            {formatDate(row.at)}
                          </td>
                          <td className={`${cell} whitespace-nowrap`}>{row.author}</td>
                          <td className={`${cell} font-mono`}>{row.shortSha}</td>
                          <td className={cell}>
                            {row.merge ? (
                              <span className="mr-1.5 rounded border border-slate-300 bg-slate-50 px-1 py-0.5 text-[9px] uppercase text-muted">
                                ветка
                              </span>
                            ) : null}
                            {row.subject}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-xs text-muted">
                    История коммитов недоступна: приложение развёрнуто без git-копии.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
