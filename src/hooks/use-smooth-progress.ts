"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Плавно догоняет целевой % и слегка ползёт вперёд, пока идёт обработка,
 * чтобы полоса не замирала между опросами API.
 */
export function useSmoothProgress(
  target: number,
  options?: { active?: boolean; max?: number },
) {
  const active = options?.active ?? true;
  const max = options?.max ?? 99.5;
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);
  const targetRef = useRef(target);

  useEffect(() => {
    targetRef.current = Math.max(0, Math.min(100, target));
  }, [target]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const goal = targetRef.current;
      let next = valueRef.current;

      const gap = goal - next;
      if (Math.abs(gap) > 0.05) {
        const rate = gap > 0 ? 4.5 : 2.2;
        next += gap * Math.min(1, rate * dt);
      } else {
        next = goal;
      }

      if (active && next < max) {
        const headroom = Math.max(0, Math.min(max, goal + 2.5) - next);
        if (headroom > 0.05) {
          next += Math.min(headroom, 0.35 * dt);
        }
      }

      next = Math.max(0, Math.min(active ? max : 100, next));
      if (Math.abs(next - valueRef.current) >= 0.05) {
        valueRef.current = next;
        setValue(next);
      } else {
        valueRef.current = next;
      }
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [active, max]);

  return value;
}
