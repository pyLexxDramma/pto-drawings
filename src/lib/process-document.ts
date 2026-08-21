/**
 * ЗАМЕНА ДЛЯ src/lib/process-document.ts во фронтенде (pto-drawings).
 *
 * Вместо разбора текстового слоя через unpdf документ уходит в наш конвейер
 * (backend/service) и возвращается листами по мере готовности.
 *
 * Интерфейс модуля не меняется: наружу по-прежнему торчит processDocument(id),
 * поэтому src/app/api/documents/route.ts и .../process/route.ts править не надо.
 *
 * Что важно знать:
 *  - PDF не пересылается: сервис читает его прямо из uploads/ фронта, поэтому
 *    бэкенд должен быть запущен с PTO_ALLOWED_PDF_ROOTS на эту папку;
 *  - при перезапуске Next идущий прогон не теряется — клиент находит задачу
 *    по documentId и подхватывает прогресс;
 *  - листы, посчитанные раньше, конвейер не пересчитывает.
 *
 * Про устойчивость. Прогон документа идёт часами (лист чертежа — до 15 минут),
 * то есть клиент успевает сделать тысячи запросов. Сетевой сбой на этой
 * дистанции неизбежен: keep-alive соединение закрывается на той стороне, и
 * fetch падает с «fetch failed». Поэтому здесь есть ретраи, а одиночная
 * ошибка не имеет права уронить весь прогон — иначе бэкенд досчитывает
 * документ до конца, а интерфейс показывает ошибку и половину листов.
 */
import { getDocument, updateDocument } from "@/lib/storage";
import type { DocumentPage, DocumentRecord, ProcessingStep } from "@/types";
import path from "path";

const BACKEND_URL = (
  process.env.PTO_BACKEND_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const POLL_MS = Number(process.env.PTO_POLL_MS ?? 3000);
const PAGES_PER_TICK = 40;
// Одна попытка запроса из трёх обычно проходит; сдаёмся только если сервис
// молчит подряд столько тиков, что это уже не икота, а падение.
const REQUEST_ATTEMPTS = 3;
const MAX_CONSECUTIVE_FAILURES = Number(process.env.PTO_MAX_FAILURES ?? 20);

// Так же, как persist.ts вычисляет папку загрузок.
const ROOT = process.env.DATA_ROOT || process.cwd();
const UPLOAD_DIR = path.join(ROOT, "uploads");

const CANCEL_PENDING = "Отмена… останавливаем после текущего листа.";

type BackendStatus = "queued" | "processing" | "done" | "error" | "canceled";

type BackendJob = {
  id: string;
  status: BackendStatus;
  pageCount: number;
  pagesDone: number[];
  pagesDoneCount: number;
  pagesTotal: number;
  processingPage: number | null;
  processingStep: ProcessingStep | null;
  errorMessage: string | null;
  pageErrors: Record<string, string>;
  usage?: Record<string, number>;
  elapsedSec?: number | null;
  cancelRequested?: boolean;
  profile?: { mode?: string; model?: string | null; provider?: string | null };
};

type BackendPage = {
  pageNumber: number;
  kind: DocumentPage["kind"];
  markdown: string;
  extractedText: string;
};

const running = new Set<string>();
/** Отмена запрошена из UI — поллер не должен возвращать документ в «активную» обработку. */
const canceling = new Set<string>();

/** Идентификаторы документов, которые реально обрабатываются в этом процессе. */
export function activeDocumentIds() {
  return new Set(running);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isCancelMessage(message: string | null | undefined) {
  return Boolean(message && message.startsWith("Отмена"));
}

/** Ошибка, которую нет смысла повторять (неверный запрос, нет задачи). */
class PermanentError extends Error {}

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${BACKEND_URL}${pathname}`, {
        ...init,
        cache: "no-store",
      });

      if (response.ok) return (await response.json()) as T;

      const detail = await response.text().catch(() => "");
      const message = `Конвейер ответил ${response.status}${
        detail ? `: ${detail.slice(0, 200)}` : ""
      }`;
      // 4xx (кроме 429) — наша ошибка, повтор не поможет.
      if (response.status < 500 && response.status !== 429) {
        throw new PermanentError(message);
      }
      lastError = new Error(message);
    } catch (error) {
      if (error instanceof PermanentError) throw error;
      lastError = error;
    }

    if (attempt < REQUEST_ATTEMPTS) await sleep(1000 * attempt);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Конвейер недоступен");
}

async function findExistingJob(documentId: string): Promise<BackendJob | null> {
  const payload = await api<{ jobs: BackendJob[] }>(
    `/jobs?documentId=${encodeURIComponent(documentId)}`,
  );
  const jobs = payload.jobs ?? [];
  if (jobs.length === 0) return null;
  // Живая задача важнее завершённой: после перезапуска Next подхватываем её.
  return (
    jobs.find((job) => job.status === "processing" || job.status === "queued") ??
    jobs[jobs.length - 1]
  );
}

async function findActiveJob(documentId: string): Promise<BackendJob | null> {
  const payload = await api<{ jobs: BackendJob[] }>(
    `/jobs?documentId=${encodeURIComponent(documentId)}`,
  );
  return (
    (payload.jobs ?? []).find(
      (job) => job.status === "processing" || job.status === "queued",
    ) ?? null
  );
}

async function createJob(document: DocumentRecord): Promise<BackendJob> {
  // Файл не пересылается: бэкенд стоит рядом и читает его из той же папки
  // uploads по пути. Поэтому сервису нужен PTO_ALLOWED_PDF_ROOTS на неё.
  return api<BackendJob>("/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: path.join(UPLOAD_DIR, document.storedName),
      originalName: document.originalName,
      projectId: document.projectId,
      documentId: document.id,
    }),
  });
}

async function fetchPages(
  jobId: string,
  numbers: number[],
): Promise<BackendPage[]> {
  if (numbers.length === 0) return [];
  const payload = await api<{ pages: BackendPage[] }>(
    `/jobs/${jobId}/pages?pages=${numbers.join(",")}`,
  );
  return payload.pages ?? [];
}

function mapStatus(status: BackendStatus): DocumentRecord["status"] {
  // У фронта нет отдельного «отменён» — показываем как ошибку с пояснением.
  if (status === "canceled") return "error";
  return status;
}

function stepFor(job: BackendJob): ProcessingStep | null {
  if (job.status === "done") return "done";
  if (job.status === "queued") return "queued";
  if (job.status === "processing") return job.processingStep ?? "text";
  return null;
}

function pipelinePatch(job: BackendJob, options?: { finished?: boolean }) {
  const mode = job.profile?.mode;
  const finished =
    options?.finished ??
    (job.status === "done" ||
      job.status === "error" ||
      job.status === "canceled");
  return {
    pipelineMode:
      mode === "mock" || mode === "real" ? (mode as "mock" | "real") : null,
    pipelineElapsedSec:
      typeof job.elapsedSec === "number" ? job.elapsedSec : null,
    ...(finished ? { pipelineFinishedAt: new Date().toISOString() } : {}),
    pipelineUsage: job.usage ?? {},
    pageErrors: job.pageErrors ?? {},
  };
}

function cancelMessage(job: BackendJob | null) {
  const ready = job?.pagesDoneCount ?? 0;
  return ready > 0
    ? `Обработка отменена. Сохранено листов: ${ready}. Можно «Обработать заново» — готовые не пересчитаются.`
    : "Обработка отменена.";
}

export async function cancelDocument(id: string) {
  canceling.add(id);

  // Сразу в БД — UI и поллер увидят отмену даже если бэкенд тормозит / HMR сбросил Set.
  const pending = await updateDocument(id, {
    processingStep: null,
    errorMessage: CANCEL_PENDING,
  });

  try {
    const active = await findActiveJob(id);
    if (!active) {
      canceling.delete(id);
      const any = await findExistingJob(id);
      return (
        (await updateDocument(id, {
          status: "error",
          processingStep: null,
          processingPage: null,
          pipelineFinishedAt: new Date().toISOString(),
          errorMessage: any
            ? cancelMessage(any)
            : "Обработка отменена. Активная задача конвейера не найдена.",
        })) ?? pending
      );
    }

    await api<BackendJob>(`/jobs/${active.id}/cancel`, { method: "POST" });
    const current = await api<BackendJob>(`/jobs/${active.id}`);
    const stopped = current.status === "canceled";
    if (stopped) canceling.delete(id);

    return (
      (await updateDocument(id, {
        status: stopped ? "error" : "processing",
        processingStep: null,
        processingPage: stopped ? null : current.processingPage,
        errorMessage: stopped ? cancelMessage(current) : CANCEL_PENDING,
        ...pipelinePatch(current, { finished: stopped }),
      })) ?? pending
    );
  } catch (error) {
    // Флаг в БД уже стоит — поллер/processDocument продолжат дожимать отмену.
    const message =
      error instanceof Error ? error.message : "Не удалось связаться с конвейером";
    return (
      (await updateDocument(id, {
        processingStep: null,
        errorMessage: `${CANCEL_PENDING} (${message})`,
      })) ?? pending
    );
  }
}

export async function processDocument(id: string) {
  if (running.has(id)) return;
  running.add(id);

  try {
    const document = await getDocument(id);
    if (!document) return;

    await updateDocument(id, {
      status: "processing",
      processingStep: "queued",
      processingPage: null,
      errorMessage: null,
      pageErrors: {},
      pipelineFinishedAt: null,
      pipelineElapsedSec: null,
    });

    const job = (await findExistingJob(id)) ?? (await createJob(document));
    const pages = new Map<number, DocumentPage>(
      document.pages.map((page) => [page.pageNumber, page]),
    );
    // storage.ts переписывает весь db.json целиком, поэтому пишем только когда
    // реально что-то изменилось. Иначе на длинном прогоне мы бы перезаписывали
    // базу каждые POLL_MS без причины.
    let lastSignature = "";
    let failures = 0;
    let cancelPosted = false;

    for (;;) {
      let current: BackendJob;
      try {
        current = await api<BackendJob>(`/jobs/${job.id}`);

        const missing = current.pagesDone
          .filter((pageNumber) => !pages.has(pageNumber))
          .slice(0, PAGES_PER_TICK);
        for (const page of await fetchPages(job.id, missing)) {
          pages.set(page.pageNumber, {
            pageNumber: page.pageNumber,
            kind: page.kind,
            markdown: page.markdown,
            extractedText: page.extractedText,
            source: "model",
            warnings: [],
          });
        }
        failures = 0;
      } catch (error) {
        if (error instanceof PermanentError) throw error;
        failures += 1;
        // Бэкенд считает документ часами и переживает сетевые сбои. Клиент
        // обязан вести себя так же, иначе прогон продолжится, а интерфейс
        // покажет ошибку и половину листов.
        if (failures >= MAX_CONSECUTIVE_FAILURES) throw error;
        console.warn(
          `[pto] конвейер не ответил (${failures}/${MAX_CONSECUTIVE_FAILURES}), повтор:`,
          error instanceof Error ? error.message : error,
        );
        await sleep(POLL_MS);
        continue;
      }

      const snap = await getDocument(id);
      const wantsCancel =
        canceling.has(id) ||
        isCancelMessage(snap?.errorMessage) ||
        Boolean(current.cancelRequested);

      if (
        wantsCancel &&
        !cancelPosted &&
        (current.status === "queued" || current.status === "processing") &&
        !current.cancelRequested
      ) {
        try {
          await api<BackendJob>(`/jobs/${job.id}/cancel`, { method: "POST" });
          cancelPosted = true;
          current = await api<BackendJob>(`/jobs/${job.id}`);
        } catch (error) {
          console.warn(
            "[pto] не удалось отправить cancel на конвейер:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      const finished =
        current.status === "done" ||
        current.status === "error" ||
        current.status === "canceled";
      const canceled = current.status === "canceled";
      const failedPages = Object.keys(current.pageErrors ?? {}).length;
      const usageKey = Object.entries(current.usage ?? {})
        .map(([key, value]) => `${key}:${value}`)
        .join(",");

      const signature = [
        current.status,
        stepFor(current),
        current.processingPage,
        pages.size,
        failedPages,
        Math.floor(current.elapsedSec ?? 0),
        usageKey,
        wantsCancel ? "cancel" : "",
        canceled ? "stopped" : "",
      ].join("|");

      if (signature !== lastSignature) {
        lastSignature = signature;
        await updateDocument(id, {
          status: canceled
            ? "error"
            : wantsCancel
              ? "processing"
              : mapStatus(current.status),
          processingStep:
            canceled || wantsCancel ? null : stepFor(current),
          processingPage: canceled ? null : current.processingPage,
          pageCount: current.pageCount || document.pageCount,
          pages: [...pages.values()].sort((a, b) => a.pageNumber - b.pageNumber),
          errorMessage: canceled
            ? cancelMessage(current)
            : wantsCancel
              ? CANCEL_PENDING
              : current.errorMessage ??
                (finished && failedPages
                  ? `Не удалось обработать листов: ${failedPages}`
                  : null),
          ...pipelinePatch(current, {
            finished: canceled || (finished && !wantsCancel),
          }),
        });
      }

      if (canceled || finished) {
        canceling.delete(id);
        return;
      }
      await sleep(POLL_MS);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось обработать файл";
    // Листы, которые успели прийти, уже лежат в базе — статус ошибки их не
    // стирает. Повторный запуск обработки заберёт остальное с бэкенда, ничего
    // не пересчитывая.
    await updateDocument(id, {
      status: "error",
      processingStep: null,
      processingPage: null,
      pipelineFinishedAt: new Date().toISOString(),
      errorMessage: `${message}. Нажмите «Обработать заново» — готовые листы подтянутся без пересчёта.`,
    });
  } finally {
    running.delete(id);
    canceling.delete(id);
  }
}
