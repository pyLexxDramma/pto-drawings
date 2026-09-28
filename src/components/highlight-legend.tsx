"use client";

type LegendProps = {
  /** Совпадения поиска по листу. */
  find: boolean;
};

/**
 * Ключ к подсветке листа. Квадратики красятся теми же классами, что и сама
 * подсветка на чертеже, — так ключ не может разойтись с тем, что видно.
 * «Место замечания» и «другое место» в ключе не показываем: рамки на листе
 * и так понятны.
 */
export function HighlightLegend({ find }: LegendProps) {
  if (!find) return null;

  return (
    <span className="pointer-events-auto inline-flex items-center gap-2 rounded border border-border bg-white/92 px-2 py-1 pto-t-sm text-muted shadow-sm backdrop-blur">
      <span className="inline-flex items-center gap-1">
        <span
          className="pto-swatch pto-find-focus inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
          aria-hidden
        />
        найдено поиском
      </span>
    </span>
  );
}
