/**
 * Журнал действий и ошибок для админа: что сработало, что нет и на чьей стороне.
 *
 * Пишем построчно в data/logs/ГГГГ-MM-ДД.ndjson через appendFile: поток событий
 * нельзя гнать через withDataLock, тот замок перезаписывает файл целиком и
 * сериализует все запросы приложения.
 */
import { appendFile, mkdir, readdir, readFile, rm, stat } from "fs/promises";
import path from "path";

/** Кто виноват: браузер, сервер интерфейса, конвейер расшифровки, агент ИИ. */
export type LogLayer = "front" | "back" | "pipeline" | "agent";

export type LogEvent = {
  at: string;
  layer: LogLayer;
  /** Что делали: upload, process, reviews.import, page, click… */
  action: string;
  ok: boolean;
  /** Почему не отработало. */
  message?: string | null;
  /** Код ответа, если действие шло запросом. */
  status?: number | null;
  userName?: string | null;
  project?: string | null;
  document?: string | null;
  page?: number | null;
  ms?: number | null;
  url?: string | null;
};

export const LOG_LAYERS: LogLayer[] = ["front", "back", "pipeline", "agent"];

export const LOG_LAYER_LABEL: Record<LogLayer, string> = {
  front: "Фронт",
  back: "Бэк интерфейса",
  pipeline: "Конвейер",
  agent: "Агент ИИ",
};

const ROOT = process.env.DATA_ROOT || process.cwd();
const LOG_DIR = path.join(ROOT, "data", "logs");
const KEEP_DAYS = Number(process.env.PTO_LOG_KEEP_DAYS ?? 14);
/** Дальше этого размера за сутки пишем только ошибки — диск важнее статистики. */
const DAY_SOFT_LIMIT_BYTES = 16 * 1024 * 1024;
const MAX_TEXT = 500;

let prunedDay = "";

function dayKey(at: string): string {
  return at.slice(0, 10);
}

function dayFile(day: string): string {
  return path.join(LOG_DIR, `${day}.ndjson`);
}

function clip(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

/** Снести файлы старше срока хранения. Отдельно от записи — чтобы можно было проверить. */
export async function pruneOldDays() {
  try {
    const names = await readdir(LOG_DIR);
    const edge = new Date(Date.now() - KEEP_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    for (const name of names) {
      const match = /^(\d{4}-\d{2}-\d{2})\.ndjson$/.exec(name);
      if (match && match[1] < edge) {
        await rm(path.join(LOG_DIR, name), { force: true }).catch(() => undefined);
      }
    }
  } catch {
    // каталога ещё нет
  }
}

async function daySizeBytes(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

/**
 * Одна запись в журнал. Никогда не бросает: сломанный лог не должен ронять
 * само действие, ради которого его пишут.
 */
export async function logEvent(input: {
  layer: LogLayer;
  action: string;
  ok: boolean;
  message?: unknown;
  status?: number | null;
  userName?: string | null;
  project?: string | null;
  document?: string | null;
  page?: number | null;
  ms?: number | null;
  url?: string | null;
  at?: string;
}): Promise<void> {
  try {
    const at = input.at ?? new Date().toISOString();
    const day = dayKey(at);
    const file = dayFile(day);
    await mkdir(LOG_DIR, { recursive: true });
    // Чистим раз в сутки на процесс: readdir на каждое событие лишний.
    if (prunedDay !== day) {
      prunedDay = day;
      await pruneOldDays();
    }

    if (input.ok && (await daySizeBytes(file)) > DAY_SOFT_LIMIT_BYTES) return;

    const event: LogEvent = {
      at,
      layer: input.layer,
      action: clip(input.action) ?? "?",
      ok: input.ok,
      message: clip(input.message),
      status: num(input.status),
      userName: clip(input.userName),
      project: clip(input.project),
      document: clip(input.document),
      page: num(input.page),
      ms: num(input.ms),
      url: clip(input.url),
    };
    await appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // журнал — вспомогательный, тишина лучше падения запроса
  }
}

/** Ошибка со стороны: сразу видно, кому идти с вопросом. */
export function logFailure(
  layer: LogLayer,
  action: string,
  error: unknown,
  extra: Omit<Parameters<typeof logEvent>[0], "layer" | "action" | "ok" | "message"> = {},
): Promise<void> {
  return logEvent({
    ...extra,
    layer,
    action,
    ok: false,
    message: error instanceof Error ? error.message : error,
  });
}

function parseLine(line: string): LogEvent | null {
  try {
    const raw = JSON.parse(line) as Partial<LogEvent>;
    if (!raw.at || !raw.layer || !raw.action) return null;
    if (!LOG_LAYERS.includes(raw.layer)) return null;
    return {
      at: raw.at,
      layer: raw.layer,
      action: raw.action,
      ok: Boolean(raw.ok),
      message: raw.message ?? null,
      status: raw.status ?? null,
      userName: raw.userName ?? null,
      project: raw.project ?? null,
      document: raw.document ?? null,
      page: raw.page ?? null,
      ms: raw.ms ?? null,
      url: raw.url ?? null,
    };
  } catch {
    return null;
  }
}

/** Последние записи, свежие сверху. Читаем с последнего дня и назад. */
export async function readEventLog(options?: {
  days?: number;
  limit?: number;
  onlyErrors?: boolean;
  layer?: LogLayer | "all";
}): Promise<{ rows: LogEvent[]; days: string[] }> {
  const limit = options?.limit ?? 400;
  const window = options?.days ?? KEEP_DAYS;
  let names: string[];
  try {
    names = await readdir(LOG_DIR);
  } catch {
    return { rows: [], days: [] };
  }

  const days = names
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(name))
    .map((name) => name.slice(0, 10))
    .sort()
    .reverse()
    .slice(0, window);

  const rows: LogEvent[] = [];
  for (const day of days) {
    let text: string;
    try {
      text = await readFile(dayFile(day), "utf8");
    } catch {
      continue;
    }
    const parsed: LogEvent[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const event = parseLine(line);
      if (!event) continue;
      if (options?.onlyErrors && event.ok) continue;
      if (options?.layer && options.layer !== "all" && event.layer !== options.layer) {
        continue;
      }
      parsed.push(event);
    }
    // Внутри файла записи идут по возрастанию времени — разворачиваем.
    parsed.reverse();
    rows.push(...parsed);
    if (rows.length >= limit) break;
  }

  return { rows: rows.slice(0, limit), days };
}
