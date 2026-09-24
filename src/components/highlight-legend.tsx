"use client";

type LegendProps = {
  /** Место замечания на листе. */
  place: boolean;
  /** То же замечание в других местах. */
  alt: boolean;
  /** Совпадения поиска по листу. */
  find: boolean;
};

/**
 * Ключ к подсветке листа. Квадратики красятся теми же классами, что и сама
 * подсветка на чертеже, — так ключ не может разойтись с тем, что видно. До
 * этого цветов на листе было четыре, а ключа к ним не было вовсе.
 *
 * Показываем только те цвета, которые на листе сейчас действительно есть.
 */
export function HighlightLegend({ place, alt, find }: LegendProps) {
  const items = [
    place ? { key: "place", tone: "pto-place", label: "место замечания" } : null,
    alt ? { key: "alt", tone: "pto-place-alt", label: "оно же в другом месте" } : null,
    find ? { key: "find", tone: "pto-find-focus", label: "найдено поиском" } : null,
  ].filter((item): item is { key: string; tone: string; label: string } =>
    Boolean(item),
  );
  if (!items.length) return null;

  return (
    <span className="pointer-events-auto inline-flex items-center gap-2 rounded border border-border bg-white/92 px-2 py-1 pto-t-sm text-muted shadow-sm backdrop-blur">
      {items.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-1">
          <span
            className={`pto-swatch ${item.tone} inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]`}
            aria-hidden
          />
          {item.label}
        </span>
      ))}
    </span>
  );
}
