"use client";

import type { ReactNode } from "react";
import { IconClose } from "@/components/tool-icons";

/**
 * Одна строка состояния под чертежом вместо трёх плашек: раньше поверх листа
 * висели подсказка про мышь (центр сверху), масштабная линейка (низ слева) и
 * тулбар (верх справа) — в трёх разных стилях. Здесь низ: линейка, масштаб
 * и подсказка про мышь, которую можно закрыть.
 */
export function ViewerStatusBar({
  scaleBar,
  legend,
  hint,
  onDismissHint,
  nav,
}: {
  /** Масштабная линейка листа DWG — у PDF её нет. */
  scaleBar?: ReactNode;
  /** Ключ к подсветке — только когда на листе есть что расшифровывать. */
  legend?: ReactNode;
  hint?: string | null;
  onDismissHint?: () => void;
  /** Листы и масштаб — справа в этой полосе. */
  nav?: ReactNode;
}) {
  if (!scaleBar && !legend && !hint && !nav) return null;
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex flex-wrap items-end gap-1.5">
      {scaleBar ? (
        <span className="pointer-events-auto inline-flex items-center gap-2 rounded border border-border bg-white/92 px-2 py-1 pto-t-sm text-muted shadow-sm backdrop-blur">
          {scaleBar}
        </span>
      ) : null}
      {legend}
      {nav ? (
        <span className="pointer-events-auto ml-auto inline-flex items-center rounded border border-border bg-white/92 px-1 py-0.5 shadow-sm backdrop-blur">
          {nav}
        </span>
      ) : null}
      {hint ? (
        <span className={`pointer-events-auto inline-flex items-center gap-1.5 rounded border border-border bg-white/92 px-2 py-1 pto-t-sm text-muted shadow-sm backdrop-blur ${nav ? "" : "ml-auto"}`}>
          {hint}
          {onDismissHint ? (
            <button
              type="button"
              onClick={onDismissHint}
                title="Больше не показывать"
                aria-label="Скрыть подсказку"
                className="inline-flex items-center rounded px-1 hover:bg-black/5 hover:text-text"
              >
                <IconClose className="h-3 w-3" />
              </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
