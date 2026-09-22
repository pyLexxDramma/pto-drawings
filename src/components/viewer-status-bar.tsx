"use client";

import type { ReactNode } from "react";

/**
 * Одна строка состояния под чертежом вместо трёх плашек: раньше поверх листа
 * висели подсказка про мышь (центр сверху), масштабная линейка (низ слева) и
 * тулбар (верх справа) — в трёх разных стилях. Здесь низ: линейка, масштаб
 * и подсказка про мышь, которую можно закрыть.
 */
export function ViewerStatusBar({
  scaleBar,
  hint,
  legibleWarning,
  onLegible,
  onDismissHint,
}: {
  /** Масштабная линейка листа DWG — у PDF её нет. */
  scaleBar?: ReactNode;
  hint?: string | null;
  /** Подписи мельче порога читаемости — предлагаем «Читаемо». */
  legibleWarning?: string | null;
  onLegible?: () => void;
  onDismissHint?: () => void;
}) {
  if (!scaleBar && !hint && !legibleWarning) return null;
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex flex-wrap items-end gap-1.5">
      {scaleBar || legibleWarning ? (
        <span className="pointer-events-auto inline-flex items-center gap-2 rounded border border-border bg-white/92 px-2 py-1 pto-t-sm text-muted shadow-sm backdrop-blur">
          {scaleBar}
          {legibleWarning ? (
            <>
              {scaleBar ? <span className="text-border">·</span> : null}
              <span className="text-amber-800">{legibleWarning}</span>
              {onLegible ? (
                <button
                  type="button"
                  onClick={onLegible}
                  className="rounded border border-accent px-1.5 py-0.5 font-semibold text-accent hover:bg-accent/10"
                >
                  Читаемо
                </button>
              ) : null}
            </>
          ) : null}
        </span>
      ) : null}
      {hint ? (
        <span className="pointer-events-auto ml-auto inline-flex items-center gap-1.5 rounded border border-border bg-white/92 px-2 py-1 pto-t-sm text-muted shadow-sm backdrop-blur">
          {hint}
          {onDismissHint ? (
            <button
              type="button"
              onClick={onDismissHint}
              title="Больше не показывать"
              aria-label="Скрыть подсказку"
              className="rounded px-1 leading-none hover:bg-black/5 hover:text-text"
            >
              ×
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
