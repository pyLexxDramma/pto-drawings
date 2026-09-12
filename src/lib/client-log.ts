"use client";

/**
 * Сбор ошибок браузера в журнал админа. Отправляем пачками и с дедупликацией:
 * один и тот же сбой в React-рендере успевает выстрелить десятки раз.
 */

type ClientEvent = {
  action: string;
  ok?: boolean;
  message?: string;
  status?: number;
  url?: string;
  page?: number;
  document?: string;
  project?: string;
  ms?: number;
};

const FLUSH_MS = 1500;
const DEDUP_MS = 20_000;
const MAX_QUEUE = 20;

let queue: ClientEvent[] = [];
let timer: number | null = null;
const seen = new Map<string, number>();
let installed = false;

function fresh(key: string): boolean {
  const now = Date.now();
  const last = seen.get(key);
  if (last && now - last < DEDUP_MS) return false;
  seen.set(key, now);
  if (seen.size > 200) {
    for (const [item, at] of seen) {
      if (now - at > DEDUP_MS) seen.delete(item);
    }
  }
  return true;
}

function flush() {
  timer = null;
  if (queue.length === 0) return;
  const events = queue;
  queue = [];
  const body = JSON.stringify({ events });
  try {
    // keepalive, чтобы событие ушло даже если страницу закрывают.
    void fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // журнал не должен ломать работу интерфейса
  }
}

/** Записать действие или ошибку интерфейса. */
export function logClient(event: ClientEvent) {
  if (typeof window === "undefined") return;
  const key = `${event.action}|${event.ok === false}|${event.message ?? ""}|${event.status ?? ""}`;
  if (!fresh(key)) return;
  queue.push({ ...event, url: event.url ?? window.location.pathname });
  if (queue.length >= MAX_QUEUE) {
    if (timer) window.clearTimeout(timer);
    flush();
    return;
  }
  if (timer === null) timer = window.setTimeout(flush, FLUSH_MS);
}

export function logClientFailure(
  action: string,
  error: unknown,
  extra: Omit<ClientEvent, "action" | "ok" | "message"> = {},
) {
  logClient({
    ...extra,
    action,
    ok: false,
    message: error instanceof Error ? error.message : String(error ?? "unknown"),
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.pathname;
  return input.url;
}

/**
 * Каждое действие интерфейса — это запрос к серверу, поэтому «отработало или
 * нет» ловим на fetch. Удачные не пишем: поллинг прогресса забил бы журнал.
 */
function watchFetch() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = urlOf(input);
    if (url.includes("/api/log")) return original(input, init);
    const started = Date.now();
    try {
      const response = await original(input, init);
      if (!response.ok) {
        logClient({
          action: `${init?.method ?? "GET"} ${url.split("?")[0]}`,
          ok: false,
          status: response.status,
          message: `сервер ответил ${response.status}`,
          ms: Date.now() - started,
        });
      }
      return response;
    } catch (error) {
      // Сюда попадают обрыв сети и закрытая вкладка — запрос до сервера не дошёл.
      if ((error as Error)?.name !== "AbortError") {
        logClientFailure(`${init?.method ?? "GET"} ${url.split("?")[0]}`, error, {
          ms: Date.now() - started,
        });
      }
      throw error;
    }
  };
}

/** Глобальные ловушки: необработанные исключения, промисы и запросы. */
export function installClientLog() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  watchFetch();

  window.addEventListener("error", (event) => {
    logClient({
      action: "browser.error",
      ok: false,
      message: event.message || String(event.error ?? "unknown"),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    logClient({
      action: "browser.promise",
      ok: false,
      message: reason instanceof Error ? reason.message : String(reason ?? "unknown"),
    });
  });

  window.addEventListener("pagehide", () => {
    if (timer) window.clearTimeout(timer);
    flush();
  });
}
