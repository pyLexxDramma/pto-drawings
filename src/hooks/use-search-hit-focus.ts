import { useEffect, useRef, useState } from "react";
import type { PageRegion } from "@/hooks/use-page-viewport";

type Cursor = { key: string; index: number; stepped: boolean };

/**
 * Поиск по листу: довести кадр до совпадения и листать совпадения.
 * На мелком масштабе рамка занимает пару пикселей — без этого её не видно.
 */
export function useSearchHitFocus({
  hits,
  query,
  pageNumber,
  ready,
  auto = true,
  zoomToRect,
}: {
  hits: PageRegion[];
  query: string;
  pageNumber: number;
  ready: boolean;
  /** Выключено, когда кадр уже ведёт «Где в ПД» — иначе два зума спорят. */
  auto?: boolean;
  zoomToRect: (rect: PageRegion, opts?: { highlight?: boolean; gentle?: boolean }) => void;
}) {
  const key = `${query.trim()}#${pageNumber}`;
  // Новая цитата или лист — курсор считаем с нуля, без сброса через эффект.
  const [cursor, setCursor] = useState<Cursor>({ key, index: 0, stepped: false });
  const live = cursor.key === key ? cursor : { key, index: 0, stepped: false };

  const zoomRef = useRef(zoomToRect);
  useEffect(() => {
    zoomRef.current = zoomToRect;
  }, [zoomToRect]);

  const count = hits.length;
  const index = count > 0 ? Math.min(live.index, count - 1) : 0;
  const hit = hits[index];

  const appliedRef = useRef("");
  useEffect(() => {
    if (!ready || !hit) return;
    if (!auto && !live.stepped) return;
    const applied = `${key}#${index}`;
    if (appliedRef.current === applied) return;
    appliedRef.current = applied;
    zoomRef.current(hit, { highlight: true, gentle: true });
  }, [auto, hit, index, key, live.stepped, ready]);

  return {
    index,
    count,
    step(delta: number) {
      if (count === 0) return;
      setCursor({
        key,
        index: (index + delta + count) % count,
        stepped: true,
      });
    },
  };
}
