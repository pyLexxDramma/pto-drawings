/** Клиент HTTP-конвейера PTO-work (серверная сторона Next). */

export const PIPELINE_URL = (
  process.env.PTO_BACKEND_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");

export type PipelineMode = "mock" | "real";

export type PipelineHealth = {
  ok: boolean;
  mode: PipelineMode | string;
  /** Откуда взят режим: PTO_PIPELINE_MODE / USE_MOCK_PROCESSOR / env / default-local. */
  modeSource?: string;
  profile: {
    mode?: string;
    modeSource?: string;
    model?: string | null;
    provider?: string | null;
  };
  reachable: boolean;
  error?: string;
  /** Суммарный расход токенов по документам в базе фронта. */
  usage?: Record<string, number>;
};

export type PipelineJob = {
  id: string;
  documentId?: string | null;
  status: string;
  pageErrors?: Record<string, string>;
  usage?: Record<string, number>;
  profile?: { mode?: string; model?: string | null; provider?: string | null };
  elapsedSec?: number | null;
};

async function pipelineFetch(pathname: string, init?: RequestInit) {
  return fetch(`${PIPELINE_URL}${pathname}`, {
    ...init,
    cache: "no-store",
  });
}

export async function fetchPipelineHealth(): Promise<PipelineHealth> {
  try {
    const response = await pipelineFetch("/health");
    if (!response.ok) {
      return {
        ok: false,
        mode: "unknown",
        profile: {},
        reachable: false,
        error: `HTTP ${response.status}`,
      };
    }
    const data = (await response.json()) as Omit<PipelineHealth, "reachable">;
    return {
      ok: Boolean(data.ok),
      mode: data.mode ?? "unknown",
      modeSource:
        data.modeSource ?? data.profile?.modeSource ?? undefined,
      profile: data.profile ?? {},
      reachable: true,
    };
  } catch (error) {
    return {
      ok: false,
      mode: "unknown",
      profile: {},
      reachable: false,
      error: error instanceof Error ? error.message : "unreachable",
    };
  }
}

export async function findPipelineJob(
  documentId: string,
): Promise<PipelineJob | null> {
  const response = await pipelineFetch(
    `/jobs?documentId=${encodeURIComponent(documentId)}`,
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as { jobs?: PipelineJob[] } | PipelineJob[];
  const jobs = Array.isArray(payload) ? payload : (payload.jobs ?? []);
  return (
    jobs.find((job) => job.status === "processing" || job.status === "queued") ??
    jobs[jobs.length - 1] ??
    null
  );
}

/** Прокси к конвейеру: геометрия / превью листа DWG. */
export async function fetchPipelinePageAsset(
  documentId: string,
  pageNumber: number,
  kind: "geometry" | "preview",
  previewFormat: "png" | "svg" = "png",
): Promise<Response> {
  const job = await findPipelineJob(documentId);
  if (!job) {
    return new Response(JSON.stringify({ error: "Нет задачи конвейера для документа" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const path =
    kind === "geometry"
      ? `/jobs/${job.id}/pages/${pageNumber}/geometry`
      : `/jobs/${job.id}/pages/${pageNumber}/preview?format=${previewFormat}`;
  return pipelineFetch(path);
}

export async function cancelPipelineJob(jobId: string): Promise<PipelineJob> {
  const response = await pipelineFetch(`/jobs/${jobId}/cancel`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Не удалось отменить задачу (${response.status})`);
  }
  return (await response.json()) as PipelineJob;
}

export function mergePipelineUsage(
  ...items: Array<Record<string, number> | null | undefined>
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    if (!item) continue;
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        result[key] = (result[key] ?? 0) + value;
      }
    }
  }
  return result;
}

export function formatPipelineUsage(usage: Record<string, number> | null | undefined) {
  if (!usage || Object.keys(usage).length === 0) return null;
  const total =
    usage.total_tokens ??
    usage.total ??
    (typeof usage.prompt_tokens === "number" &&
    typeof usage.completion_tokens === "number"
      ? usage.prompt_tokens + usage.completion_tokens
      : null);
  if (typeof total === "number" && Number.isFinite(total)) {
    return `${Math.round(total).toLocaleString("ru-RU")} токенов`;
  }
  const parts = Object.entries(usage)
    .filter(([, value]) => typeof value === "number")
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${Math.round(value)}`);
  return parts.length ? parts.join(", ") : null;
}

export function formatElapsed(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return null;
  if (sec < 60) return `${Math.round(sec)} с`;
  const minutes = Math.floor(sec / 60);
  const rest = Math.round(sec % 60);
  return `${minutes} мин ${rest} с`;
}
