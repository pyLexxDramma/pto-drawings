"use client";

import { useMemo, useState } from "react";
import type { ProcessingAlert } from "@/lib/processing-alerts";

const STORAGE_KEY = "pto-dismissed-processing-alerts";
const VISIBLE = 6;

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // квота / приватный режим — плашка просто вернётся после перезагрузки
  }
}

export function SiteDownBanner() {
  return (
    <div
      className="shrink-0 border-b border-red-300 bg-red-600 px-3 py-2.5 text-[13px] text-white"
      role="alert"
      aria-live="assertive"
    >
      <div className="font-semibold">Сервер не отвечает, скорее всего упал.</div>
      <div className="mt-0.5 text-white/90">
        Перезагрузи VPS в Timeweb, потом на комплекте — «Запустить заново».
      </div>
    </div>
  );
}

export function ProcessingAlertsBar({
  alerts,
  canOpenLog,
  onOpen,
  onRetry,
  onOpenLog,
}: {
  alerts: ProcessingAlert[];
  canOpenLog?: boolean;
  onOpen: (alert: ProcessingAlert) => void;
  onRetry: (documentId: string) => void;
  onOpenLog?: () => void;
}) {
  const [dismissed, setDismissed] = useState(loadDismissed);
  const visible = useMemo(
    () => alerts.filter((item) => !dismissed.has(item.id)),
    [alerts, dismissed],
  );
  if (visible.length === 0) return null;

  const shown = visible.slice(0, VISIBLE);
  const extra = visible.length - shown.length;

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  }

  function dismissAll() {
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const item of visible) next.add(item.id);
      saveDismissed(next);
      return next;
    });
  }

  return (
    <div
      className="shrink-0 border-b border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-950"
      role="alert"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">
          Не обработалось: {visible.length}
          {extra > 0 ? ` · ещё ${extra}` : ""}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canOpenLog && onOpenLog ? (
            <button
              type="button"
              className="underline decoration-red-400 underline-offset-2 hover:text-red-800"
              onClick={onOpenLog}
            >
              Журнал
            </button>
          ) : null}
          <button
            type="button"
            className="text-red-800/70 hover:text-red-950"
            onClick={dismissAll}
          >
            Скрыть
          </button>
        </div>
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {shown.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-start gap-2 rounded border border-red-200 bg-white/70 px-2 py-1.5"
          >
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => onOpen(item)}
              title={item.message}
            >
              <div className="font-semibold text-red-950">
                Не обработан
                {item.page ? ` · лист ${item.page}` : ""}
              </div>
              <div className="text-red-900/90">
                <span className="font-medium">{item.documentName}</span>
                {" — "}
                {item.message}
              </div>
            </button>
            <button
              type="button"
              className="shrink-0 rounded-md bg-red-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-red-700"
              onClick={() => onRetry(item.documentId)}
            >
              Запустить заново
            </button>
            <button
              type="button"
              className="shrink-0 px-1 text-red-800/50 hover:text-red-950"
              aria-label="Скрыть"
              onClick={() => dismiss(item.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
