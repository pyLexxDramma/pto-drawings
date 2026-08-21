"use client";

import { useCallback, useEffect, useState } from "react";

export type ToastTone = "ok" | "error" | "info";

export type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

export function useToasts() {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastTone = "info") => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems((prev) => [...prev.slice(-4), { id, message, tone }]);
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return { items, push, dismiss };
}

export function ToastHost({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((item) =>
      window.setTimeout(() => onDismiss(item.id), 5000),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [items, onDismiss]);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(100%-2rem,22rem)] flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          className={`pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-md ${
            item.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : item.tone === "error"
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-border bg-white text-text"
          }`}
          role="status"
        >
          <div className="flex items-start justify-between gap-2">
            <span>{item.message}</span>
            <button
              type="button"
              className="shrink-0 text-xs opacity-60 hover:opacity-100"
              onClick={() => onDismiss(item.id)}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Браузерное уведомление, если вкладка скрыта и разрешение есть. */
export function notifyIfHidden(title: string, body: string) {
  if (typeof document === "undefined" || typeof Notification === "undefined") {
    return;
  }
  if (document.visibilityState !== "hidden") return;
  if (Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch {
      // ignore
    }
    return;
  }
  if (Notification.permission === "default") {
    void Notification.requestPermission().then((permission) => {
      if (permission === "granted" && document.visibilityState === "hidden") {
        try {
          new Notification(title, { body });
        } catch {
          // ignore
        }
      }
    });
  }
}
