"use client";

import { useCallback, useEffect, useState } from "react";
import { ModelCheckPanel } from "@/components/model-check-panel";
import { SegmentedTabs } from "@/components/ui-chrome";
import { formatBytes, formatDate } from "@/lib/format";
import type { ModelCheckInput } from "@/lib/model-check";

/**
 * Живые журналы админа. Пустые вкладки (правки текста, замечания, отметки)
 * убраны: правки расшифровки закрыты, журнал замечания живёт в строке таблицы,
 * отметки — на самом чертеже.
 */

type Tab = "log" | "processing" | "agent" | "files" | "releases";

const TABS: {
  id: Tab;
  label: string;
  accent: "critical" | "warn" | "info" | "neutral";
}[] = [
  { id: "log", label: "Журнал действий", accent: "critical" },
  { id: "processing", label: "Ошибки обработки", accent: "warn" },
  { id: "agent", label: "Агент ИИ (ошибки)", accent: "warn" },
  { id: "files", label: "Файлы", accent: "neutral" },
  { id: "releases", label: "Обновления прода", accent: "info" },
];

const HINT: Record<Tab, string> = {
  log: "Что сработало и что нет: фронт, бэк интерфейса, конвейер, агент ИИ. Хранится 14 дней.",
  processing:
    "Расшифровка по листам: где конвейер не справился и что именно вернул.",
  agent:
    "Сверка модели по открытому листу: откуда текст, что не сошлось, чего нет в таблице.",
  files: "Загрузки файлов: кто, когда, каким конвейером расшифровали.",
  releases:
    "Что выкатили на прод: ветки коллег и правки в main. Без перечисления каждого запуска.",
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
type ProcessingRow = {
  at: string;
  project: string;
  name: string;
  page: number | null;
  level: "error" | "warning";
  message: string;
  pipelineMode: string | null;
  pipelineModel: string | null;
  elapsedSec: number | null;
};
type LogRow = {
  at: string;
  layer: LogLayer;
  action: string;
  ok: boolean;
  message: string | null;
  status: number | null;
  userName: string | null;
  document: string | null;
  page: number | null;
  ms: number | null;
  url: string | null;
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
  branches?: Branch[];
  sources?: { repo: Repo; label: string; dir: string; readable: boolean }[];
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

// Названия слоёв держим тут, а не в @/lib/event-log: тот модуль работает с fs.
type LogLayer = "front" | "back" | "pipeline" | "agent";

const LOG_LAYER_LABEL: Record<LogLayer, string> = {
  front: "Фронт",
  back: "Бэк",
  pipeline: "Конвейер",
  agent: "Агент ИИ",
};

const LAYER_CHIP: Record<LogLayer, string> = {
  front: "border-sky-200 bg-sky-50 text-sky-900",
  back: "border-slate-300 bg-slate-50 text-slate-800",
  pipeline: "border-violet-200 bg-violet-50 text-violet-900",
  agent: "border-amber-200 bg-amber-50 text-amber-900",
};

const LAYER_FILTERS: { id: LogLayer | "all"; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "front", label: LOG_LAYER_LABEL.front },
  { id: "back", label: LOG_LAYER_LABEL.back },
  { id: "pipeline", label: LOG_LAYER_LABEL.pipeline },
  { id: "agent", label: LOG_LAYER_LABEL.agent },
];

function LayerChip({ layer }: { layer: LogLayer }) {
  return (
    <span
      className={`whitespace-nowrap rounded border px-1 py-0.5 text-[9px] uppercase ${LAYER_CHIP[layer]}`}
    >
      {LOG_LAYER_LABEL[layer]}
    </span>
  );
}

const cell = "px-2 py-1.5 align-top";
const head = "px-2 py-1.5 text-left font-medium";

export function AuditPanel({
  open,
  onClose,
  initialTab = "log",
  modelCheck = null,
}: {
  open: boolean;
  onClose: () => void;
  initialTab?: Tab;
  modelCheck?: { count: number; input: ModelCheckInput } | null;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [layer, setLayer] = useState<LogLayer | "all">("all");
  const [onlyErrors, setOnlyErrors] = useState(false);
  // Ответ и ошибку держим вместе с разделом: пока пришёл ответ прошлой вкладки,
  // показываем «Читаем…», а не чужие строки.
  const [result, setResult] = useState<{ tab: Tab; payload: Payload } | null>(null);
  const [failure, setFailure] = useState<{ tab: Tab; message: string } | null>(null);

  const load = useCallback(async (kind: Tab, query: string, signal: AbortSignal) => {
    try {
      const response = await fetch(`/api/audit?kind=${kind}${query}`, { signal });
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

  const query =
    tab === "log"
      ? `&layer=${layer}${onlyErrors ? "&errors=1" : ""}`
      : "";

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    if (tab === "agent") return;
    const ac = new AbortController();
    void (async () => {
      if (ac.signal.aborted) return;
      await load(tab, query, ac.signal);
    })();
    return () => ac.abort();
  }, [load, open, query, tab]);

  if (!open) return null;

  const payload = result?.tab === tab ? result.payload : null;
  const error = failure?.tab === tab ? failure.message : null;
  const busy = tab !== "agent" && !payload && !error;
  const rows = (payload?.rows ?? []) as unknown[];
  const empty =
    !busy &&
    !error &&
    tab !== "releases" &&
    tab !== "agent" &&
    rows.length === 0;

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

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <SegmentedTabs
            size="xs"
            value={tab}
            onChange={(value) => setTab(value as Tab)}
            options={TABS}
          />
          {busy ? <span className="text-[11px] text-muted">Читаем…</span> : null}
        </div>

        {tab === "log" ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            <SegmentedTabs
              size="xs"
              value={layer}
              onChange={(value) => setLayer(value as LogLayer | "all")}
              options={LAYER_FILTERS}
            />
            <label className="flex items-center gap-1.5 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={onlyErrors}
                onChange={(event) => setOnlyErrors(event.target.checked)}
              />
              Только ошибки
            </label>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {error ? (
            <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          ) : null}
          {empty ? (
            <div className="py-6 text-center text-xs text-muted">Записей пока нет.</div>
          ) : null}

          {tab === "agent" ? (
            modelCheck?.input ? (
              <ModelCheckPanel input={modelCheck.input} />
            ) : (
              <div className="py-6 text-center text-xs text-muted">
                Откройте лист — сверка модели появится здесь.
              </div>
            )
          ) : null}

          {tab === "log" && rows.length ? (
            <table className="w-full border-collapse text-[11px]">
              <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className={head}>Когда</th>
                  <th className={head}>Где</th>
                  <th className={head}>Действие</th>
                  <th className={head}>Итог</th>
                  <th className={head}>Что не так</th>
                  <th className={head}>Кто</th>
                  <th className={head}>Файл / лист</th>
                </tr>
              </thead>
              <tbody>
                {(rows as LogRow[]).map((row, index) => (
                  <tr
                    key={`${row.at}-${index}`}
                    className={`border-b border-slate-200 ${row.ok ? "" : "bg-red-50/50"}`}
                  >
                    <td className={`${cell} whitespace-nowrap text-muted`}>
                      {formatDate(row.at)}
                    </td>
                    <td className={cell}>
                      <LayerChip layer={row.layer} />
                    </td>
                    <td className={cell}>
                      {row.action}
                      {row.url && row.url !== row.action ? (
                        <span className="ml-1 text-muted">{row.url}</span>
                      ) : null}
                    </td>
                    <td className={`${cell} whitespace-nowrap`}>
                      {row.ok ? (
                        <span className="text-emerald-700">ок</span>
                      ) : (
                        <span className="text-red-700">
                          сбой{row.status ? ` ${row.status}` : ""}
                        </span>
                      )}
                    </td>
                    <td className={cell}>{row.message || "—"}</td>
                    <td className={`${cell} whitespace-nowrap text-muted`}>
                      {row.userName ?? "—"}
                    </td>
                    <td className={`${cell} text-muted`}>
                      {row.document ?? "—"}
                      {row.page ? ` · лист ${row.page}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {tab === "processing" && rows.length ? (
            <table className="w-full border-collapse text-[11px]">
              <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className={head}>Когда</th>
                  <th className={head}>Проект</th>
                  <th className={head}>Файл</th>
                  <th className={head}>Лист</th>
                  <th className={head}>Что</th>
                  <th className={head}>Причина</th>
                  <th className={head}>Конвейер</th>
                </tr>
              </thead>
              <tbody>
                {(rows as ProcessingRow[]).map((row, index) => (
                  <tr
                    key={`${row.at}-${row.name}-${row.page}-${index}`}
                    className={`border-b border-slate-200 ${
                      row.level === "error" ? "bg-red-50/50" : ""
                    }`}
                  >
                    <td className={`${cell} whitespace-nowrap text-muted`}>
                      {formatDate(row.at)}
                    </td>
                    <td className={`${cell} text-muted`}>{row.project}</td>
                    <td className={cell}>{row.name}</td>
                    <td className={`${cell} tabular-nums`}>
                      {row.page ?? "весь файл"}
                    </td>
                    <td className={`${cell} whitespace-nowrap`}>
                      {row.level === "error" ? (
                        <span className="text-red-700">не вышло</span>
                      ) : (
                        <span className="text-amber-700">с дырами</span>
                      )}
                    </td>
                    <td className={cell}>{row.message}</td>
                    <td className={`${cell} text-muted`}>
                      {[row.pipelineMode, row.pipelineModel].filter(Boolean).join(" · ") ||
                        "—"}
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
                  Ветки коллег
                </div>
                <div className="mb-1 text-[11px] text-muted">
                  Состояние на момент последнего деплоя: прод подтягивает все ветки, но выкатывает
                  только main. «Слита» — код уже на проде.
                </div>
                {payload?.sources &&
                !payload.sources.some((item) => item.repo === "pipeline" && item.readable) ? (
                  <div className="mb-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                    Копию конвейера прочитать не удалось — видны только правки фронта. Путь к ней
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
