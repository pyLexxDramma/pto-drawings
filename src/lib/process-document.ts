/**
 * Документ уходит в конвейер PTO-work и возвращается листами по мере готовности.
 *
 * PDF/DWG не пересылаются: сервис читает файл из uploads/ фронта
 * (PTO_ALLOWED_PDF_ROOTS на бэке).
 */
import { runInBackground } from "@/lib/background";
import {
  fetchPipelineHealth,
  findPipelineJob,
  purgePipelineJobsForDocument,
} from "@/lib/pipeline";
import { getDocument, listDocuments, updateDocument } from "@/lib/storage";
import type { DocumentPage, DocumentRecord, ProcessingStep } from "@/types";
import path from "path";

const BACKEND_URL = (
  process.env.PTO_BACKEND_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const POLL_MS = Number(process.env.PTO_POLL_MS ?? 3000);
const PAGES_PER_TICK = 40;
const REQUEST_ATTEMPTS = 3;
/** Раньше 20 — на длинном PDF UI сдавался раньше конвейера. */
const MAX_CONSECUTIVE_FAILURES = Number(process.env.PTO_MAX_FAILURES ?? 40);

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
  pageWarnings?: Record<string, string>;
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
  trust?: {
    level: "dwg" | "layer" | "vlm" | "none";
    title: string;
    warnings: string[];
  };
  warnings?: string[];
  numbers?: {
    checked: boolean;
    total: number;
    found: number;
    precision: number | null;
    suspect: string[];
  } | null;
};

const running = new Set<string>();
const canceling = new Set<string>();

export function activeDocumentIds() {
  return new Set(running);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isCancelMessage(message: string | null | undefined) {
  return Boolean(message && message.startsWith("Отмена"));
}

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
    pipelineModel:
      typeof job.profile?.model === "string" && job.profile.model.trim()
        ? job.profile.model.trim()
        : null,
    pipelineElapsedSec:
      typeof job.elapsedSec === "number" ? job.elapsedSec : null,
    ...(finished ? { pipelineFinishedAt: new Date().toISOString() } : {}),
    pipelineUsage: job.usage ?? {},
    pageErrors: job.pageErrors ?? {},
    pageWarnings: job.pageWarnings ?? {},
  };
}

function cancelMessage(job: BackendJob | null) {
  const ready = job?.pagesDoneCount ?? 0;
  return ready > 0
    ? `Обработка отменена. Сохранено листов: ${ready}. Можно «Обработать заново» — готовые не пересчитаются.`
    : "Обработка отменена.";
}

/** Остановить поллер документа (удаление / ручная отмена). */
export function abandonDocumentProcessing(id: string) {
  canceling.add(id);
}

/**
 * После рестарта Next: если на конвейере job ещё жив — подхватить поллер,
 * а не помечать документ ошибкой (длинный PDF).
 */
export async function reconcileOrphanedJobs() {
  const active = activeDocumentIds();
  let documents: DocumentRecord[];
  try {
    documents = await listDocuments(undefined, { lite: true });
  } catch {
    return;
  }

  for (const doc of documents) {
    if (doc.status !== "queued" && doc.status !== "processing") continue;
    if (active.has(doc.id)) continue;
    if (canceling.has(doc.id)) continue;

    try {
      const job = await findPipelineJob(doc.id);
      if (
        job &&
        (job.status === "queued" ||
          job.status === "processing" ||
          job.status === "done")
      ) {
        runInBackground(processDocument(doc.id));
        continue;
      }
      if (job && (job.status === "error" || job.status === "canceled")) {
        await updateDocument(doc.id, {
          status: "error",
          processingStep: null,
          processingPage: null,
          pipelineFinishedAt: new Date().toISOString(),
          errorMessage:
            job.status === "canceled"
              ? "Обработка отменена."
              : "Ошибка конвейера. Нажмите «Обработать заново».",
        });
        continue;
      }
      await updateDocument(doc.id, {
        status: "error",
        processingStep: null,
        processingPage: null,
        pipelineFinishedAt: new Date().toISOString(),
        errorMessage: "Обработка прервалась. Нажмите «Повтор».",
      });
    } catch (error) {
      console.warn(
        `[pto] reconcile ${doc.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

/** Удаление файла: остановить поллер + снять job с конвейера. */
export async function purgeDocumentPipeline(id: string) {
  abandonDocumentProcessing(id);
  await purgePipelineJobsForDocument(id);
}

export async function cancelDocument(id: string) {
  canceling.add(id);

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

    if (!canceling.has(id) && !isCancelMessage(document.errorMessage)) {
      await updateDocument(id, {
        status: "processing",
        processingStep: "queued",
        processingPage: null,
        errorMessage: null,
        pageErrors: {},
        pipelineFinishedAt: null,
        pipelineElapsedSec: null,
      });
    }

    const job = (await findExistingJob(id)) ?? (await createJob(document));
    const pages = new Map<number, DocumentPage>(
      document.pages.map((page) => [page.pageNumber, page]),
    );
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
            // trust.level: dwg | layer — из данных; vlm — по изображению; none — пусто
            source: page.trust?.level === "vlm" ? "model" : "heuristic",
            warnings: page.warnings ?? [],
            numbers: page.numbers ?? null,
          });
        }
        failures = 0;
      } catch (error) {
        if (error instanceof PermanentError) throw error;
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          const soft = await shouldKeepPolling(id);
          if (soft) {
            failures = Math.floor(MAX_CONSECUTIVE_FAILURES / 2);
            console.warn(
              `[pto] poll fail, но job/health живы — продолжаем (${id})`,
            );
            await sleep(POLL_MS * 2);
            continue;
          }
          throw error;
        }
        console.warn(
          `[pto] конвейер не ответил (${failures}/${MAX_CONSECUTIVE_FAILURES}), повтор:`,
          error instanceof Error ? error.message : error,
        );
        await sleep(POLL_MS);
        continue;
      }

      const snap = await getDocument(id);
      if (!snap) {
        // Файл удалили в UI — выходим; purge уже на стороне DELETE.
        return;
      }
      const wantsCancel =
        canceling.has(id) ||
        isCancelMessage(snap.errorMessage) ||
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
        } catch (err) {
          console.warn(
            "[pto] не удалось отправить cancel на конвейер:",
            err instanceof Error ? err.message : err,
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
          processingStep: canceled || wantsCancel ? null : stepFor(current),
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
    if (!(await getDocument(id))) return;
    const message =
      error instanceof Error ? error.message : "Не удалось обработать файл";
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

/** Если health и/или job ещё живы — не сдаёмся с ошибкой UI. */
async function shouldKeepPolling(documentId: string): Promise<boolean> {
  try {
    const health = await fetchPipelineHealth();
    if (!health.reachable) return false;
    const job = await findExistingJob(documentId).catch(() => null);
    if (job && (job.status === "queued" || job.status === "processing")) {
      return true;
    }
    if (health.ok) return true;
  } catch {
    // ignore
  }
  return false;
}
