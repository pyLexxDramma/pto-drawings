import type { ReviewSeverity, ReviewVerdict } from "@/types";

/**
 * Важность и статус разбора — две отдельные шкалы, у каждого значения свой цвет.
 * Иначе в выпадашке «высокий» красит все пункты, а «частично» и «обсудить»
 * сливаются в один янтарный.
 */

export const SEVERITY_CHIP: Record<ReviewSeverity, string> = {
  unset: "border-dashed border-slate-400 bg-white text-slate-500",
  high: "border-rose-300 bg-rose-100 text-rose-800",
  medium: "border-amber-300 bg-amber-100 text-amber-900",
  low: "border-sky-300 bg-sky-100 text-sky-800",
  skip: "border-slate-300 bg-slate-100 text-slate-500 line-through",
};

export const VERDICT_CHIP: Record<ReviewVerdict, string> = {
  pending: "border-slate-300 bg-slate-100 text-slate-600",
  confirmed: "border-emerald-300 bg-emerald-100 text-emerald-800",
  partial: "border-violet-300 bg-violet-100 text-violet-800",
  discuss: "border-amber-300 bg-amber-100 text-amber-900",
  outdated: "border-slate-300 bg-slate-200 text-slate-500 line-through",
  wrong: "border-rose-300 bg-rose-100 text-rose-800",
};

/**
 * Красим только клетку «Замечание»: блеклая заливка и яркая рамка по важности.
 * Всю строку заливать нельзя — закрывает текст и красит номер, статус, автора.
 */
export const SEVERITY_REMARK: Record<ReviewSeverity, string> = {
  unset: "",
  high: "border-2 border-rose-500 bg-rose-50",
  medium: "border-2 border-amber-500 bg-amber-50",
  low: "border-2 border-sky-500 bg-sky-50",
  skip: "opacity-60",
};

/** Строка замечания в полосе листа: рамка по важности, заливка блеклая. */
export const SEVERITY_ITEM: Record<ReviewSeverity, string> = {
  unset: "border-slate-300 bg-white",
  high: "border-rose-500 bg-rose-50",
  medium: "border-amber-500 bg-amber-50",
  low: "border-sky-500 bg-sky-50",
  skip: "border-slate-300 bg-white opacity-60",
};

/** Чип места «л.1»: та же важность, что у замечания. */
export const SEVERITY_PLACE: Record<ReviewSeverity, string> = {
  unset: "border-slate-400 bg-white text-slate-600",
  high: "border-rose-500 bg-rose-50 text-rose-800",
  medium: "border-amber-500 bg-amber-50 text-amber-900",
  low: "border-sky-500 bg-sky-50 text-sky-800",
  skip: "border-slate-300 bg-slate-100 text-slate-500",
};

/**
 * Рамка места на чертеже и цвет мини-пина — по важности.
 * Неразобранное без важности остаётся rose: это всё равно ошибка на плане.
 */
export const SEVERITY_FRAME: Record<ReviewSeverity, string> = {
  unset: "pto-place",
  high: "pto-place pto-place--high",
  medium: "pto-place pto-place--medium",
  low: "pto-place pto-place--low",
  skip: "pto-place opacity-50",
};

/** Мини-пин на чертеже: номер замечания. Фон полупрозрачный — чертёж читается под ним. */
export const SEVERITY_PIN: Record<ReviewSeverity, string> = {
  unset: "border border-rose-700/70 bg-rose-600/45 text-rose-950",
  high: "border border-rose-700/70 bg-rose-600/45 text-rose-950",
  medium: "border border-amber-700/70 bg-amber-500/45 text-amber-950",
  low: "border border-sky-700/70 bg-sky-600/45 text-sky-950",
  skip: "border border-slate-500/60 bg-slate-400/40 text-slate-800",
};

/**
 * Номер относительно рамки. Проценты в translate считаются от самого номера,
 * поэтому сдвиг «вбок на 115%» оставлял цифру на границе рамки.
 * Узкая ячейка (буква в штампе): номер целиком за краем, не на букве.
 * У правого края листа — слева, иначе справа.
 * Длинная строка: номер над серединой, а не в левом углу, где он закрывал
 * подпись над цитатой.
 */
export function pinNumberPlace(pin: { x: number; w: number }): {
  left: number | string;
  right?: number | string;
  top: number | string;
  transform: string;
} {
  if (pin.w < 0.03) {
    if (pin.x > 0.82) {
      return {
        left: "auto",
        right: "100%",
        top: "50%",
        transform: "translate(-12px, -50%)",
      };
    }
    return { left: "100%", top: "50%", transform: "translate(12px, -50%)" };
  }
  return {
    left: "50%",
    top: 0,
    transform: "translate(-50%, calc(-100% - 3px))",
  };
}

type PinBadgeBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  number: number;
  active?: boolean;
};

/** Сдвиг номера в пикселях листа, если соседние пины закрывают друг друга. */
export function pinBadgeShifts(
  pins: PinBadgeBox[],
  page: { w: number; h: number },
  scale: number,
): { dx: number; dy: number }[] {
  const gap = 3;
  const ideals = pins.map((pin) => pinBadgeRect(pin, page, scale));
  const placed: { l: number; t: number; r: number; b: number }[] = [];
  const shifts = pins.map(() => ({ dx: 0, dy: 0 }));
  const order = pins
    .map((_, index) => index)
    .sort((a, b) => {
      const active = Number(Boolean(pins[b].active)) - Number(Boolean(pins[a].active));
      if (active !== 0) return active;
      return ideals[a].t - ideals[b].t || ideals[a].l - ideals[b].l;
    });
  for (const index of order) {
    const rect = { ...ideals[index] };
    for (let step = 0; step < 12 && placed.some((other) => pinRectsHit(rect, other, gap)); step += 1) {
      const jump = rect.r - rect.l + gap;
      const roomRight = page.w - rect.r;
      const roomLeft = rect.l;
      if (roomRight >= jump || roomRight >= roomLeft) {
        rect.l += jump;
        rect.r += jump;
      } else if (roomLeft >= jump) {
        rect.l -= jump;
        rect.r -= jump;
      } else {
        const rise = rect.b - rect.t + gap;
        rect.t -= rise;
        rect.b -= rise;
      }
    }
    shifts[index] = {
      dx: rect.l - ideals[index].l,
      dy: rect.t - ideals[index].t,
    };
    placed.push(rect);
  }
  return shifts;
}

function pinBadgeRect(pin: PinBadgeBox, page: { w: number; h: number }, scale: number) {
  const font = Math.max(7, 12 / Math.max(scale, 0.05));
  const digits = Math.max(1, String(Math.abs(pin.number)).length);
  const bw = font * 0.62 * digits + 8 / Math.max(scale, 0.05) + 4;
  const bh = font * 1.3 + 2 / Math.max(scale, 0.05) + 2;
  const boxW = Math.max(0.015, pin.w) * page.w;
  const boxH = Math.max(0.01, pin.h) * page.h;
  const boxL = pin.x * page.w;
  const boxT = pin.y * page.h;
  if (pin.w < 0.03) {
    if (pin.x > 0.82) {
      const r = boxL - 12;
      return { l: r - bw, t: boxT + boxH / 2 - bh / 2, r, b: boxT + boxH / 2 + bh / 2 };
    }
    const l = boxL + boxW + 12;
    return { l, t: boxT + boxH / 2 - bh / 2, r: l + bw, b: boxT + boxH / 2 + bh / 2 };
  }
  const cx = boxL + boxW / 2;
  const b = boxT - 3;
  return { l: cx - bw / 2, t: b - bh, r: cx + bw / 2, b };
}

function pinRectsHit(
  a: { l: number; t: number; r: number; b: number },
  b: { l: number; t: number; r: number; b: number },
  gap: number,
) {
  return a.l < b.r + gap && a.r + gap > b.l && a.t < b.b + gap && a.b + gap > b.t;
}

/** Мини-пин замечания на чертеже: номер + место + важность. */
export type DrawingRemarkPin = {
  id: string;
  number: number;
  severity: ReviewSeverity;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Цитата этого места: клик открывает его, а не первое место замечания. */
  quote?: string;
  active?: boolean;
};

/** Заливку по статусу не даём: статус читается подписью, не фоном строки. */
export const VERDICT_ROW: Partial<Record<ReviewVerdict, string>> = {};

/** Счётчик замечаний на миниатюре листа: цвет — по разбору. */
export const VERDICT_COUNT: Record<ReviewVerdict, string> = {
  pending: "bg-slate-200 text-slate-700",
  confirmed: "bg-emerald-600 text-white",
  partial: "bg-violet-500 text-white",
  discuss: "bg-amber-500 text-white",
  outdated: "bg-slate-400 text-white",
  wrong: "bg-rose-500 text-white",
};

export const VERDICT_DOT: Record<ReviewVerdict, string> = {
  pending: "bg-slate-300",
  confirmed: "bg-emerald-600",
  partial: "bg-violet-500",
  discuss: "bg-amber-500",
  outdated: "bg-slate-400",
  wrong: "bg-rose-500",
};

/**
 * «Обсудить» — точка внутри кружка, чтобы не слиться с «Частично верно».
 */
export const VERDICT_DOT_INNER: Partial<Record<ReviewVerdict, boolean>> = {
  discuss: true,
};
