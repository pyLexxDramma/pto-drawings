import type { DocumentRecord } from "@/types";

export type ProcessingAlert = {
  id: string;
  documentId: string;
  documentName: string;
  page: number | null;
  message: string;
  at: string;
};

type AlertSource = Pick<
  DocumentRecord,
  | "id"
  | "originalName"
  | "status"
  | "errorMessage"
  | "pageErrors"
  | "pipelineFinishedAt"
  | "createdAt"
>;

function isCancelMessage(message: string | null | undefined) {
  return Boolean(message && message.startsWith("Отмена"));
}

/** Падения файла и отдельных листов — то, что иначе прячется в журнале. */
export function collectProcessingAlerts(
  documents: AlertSource[],
): ProcessingAlert[] {
  const alerts: ProcessingAlert[] = [];
  for (const doc of documents) {
    const at = doc.pipelineFinishedAt ?? doc.createdAt;
    const pages = Object.entries(doc.pageErrors ?? {}).filter(
      ([, reason]) => reason.trim().length > 0,
    );
    for (const [page, reason] of pages) {
      alerts.push({
        id: `${doc.id}:p:${page}`,
        documentId: doc.id,
        documentName: doc.originalName,
        page: Number(page) || null,
        message: reason.trim(),
        at,
      });
    }
    if (isCancelMessage(doc.errorMessage)) continue;
    if (doc.status !== "error") continue;
    const message = (doc.errorMessage ?? "").trim();
    if (!message) continue;
    if (pages.length > 0 && /листов:\s*\d+/i.test(message)) continue;
    alerts.push({
      id: `${doc.id}:file`,
      documentId: doc.id,
      documentName: doc.originalName,
      page: null,
      message,
      at,
    });
  }
  alerts.sort((a, b) => b.at.localeCompare(a.at));
  return alerts;
}

export function processingFailed(doc: AlertSource): boolean {
  if (isCancelMessage(doc.errorMessage)) return false;
  if (doc.status === "error") return true;
  return Object.keys(doc.pageErrors ?? {}).length > 0;
}

/** Причина, которую показываем рядом со статусом и кнопкой «Запустить заново». */
export function processingFailureReason(doc: AlertSource): string {
  const pages = Object.entries(doc.pageErrors ?? {}).filter(
    ([, reason]) => reason.trim().length > 0,
  );
  if (pages.length === 1) {
    const [page, reason] = pages[0];
    return `лист ${page}: ${reason.trim()}`;
  }
  if (pages.length > 1) {
    return `не обработано листов: ${pages.length}. ${pages
      .slice(0, 2)
      .map(([page, reason]) => `${page}: ${reason.trim()}`)
      .join(" · ")}`;
  }
  const message = (doc.errorMessage ?? "").trim();
  if (message && !isCancelMessage(message)) return message;
  return "файл не обработан до конца";
}
