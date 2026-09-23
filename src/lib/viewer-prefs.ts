/** Предпочтения вьюера — плотность, жесты, читаемость DWG. */

/** Размер текста интерфейса живёт в CSS и идёт за шириной окна — см. globals.css. */
export type CadWheelMode = "zoom" | "pan";
export type CadTextFilter = "all" | "hide" | "text";

export type ViewerPrefs = {
  cadWheel: CadWheelMode;
  largeLabels: boolean;
  thinStrokes: boolean;
  textFilter: CadTextFilter;
  minimap: boolean;
  thumbs: boolean;
  remarks: boolean;
  sessions: number;
  hintDismissed: boolean;
  /**
   * Доля ширины под чертёж, % (баг 0098). Раздвинутую границу помним между
   * листами, файлами и сессиями: иначе каждый лист снова открывался узкой
   * колонкой текста, и инженер тянул разделитель заново.
   */
  splitDrawing: number;
  /** Доля под чертёж на листе-таблице: ведомость читается шире. */
  splitTable: number;
};

const KEY = "pto-viewer-prefs";

const DEFAULTS: ViewerPrefs = {
  cadWheel: "pan",
  largeLabels: true,
  thinStrokes: false,
  textFilter: "all",
  minimap: true,
  thumbs: false,
  remarks: true,
  sessions: 0,
  hintDismissed: false,
  // Было 66/34: на широком экране расшифровка получала треть окна и выглядела
  // узкой колонкой мелкого текста. Чертежу хватает 56%.
  splitDrawing: 56,
  splitTable: 42,
};

export const SPLIT_MIN = 22;
export const SPLIT_MAX = 82;

/** Ниже этой ширины окна расшифровка стартует уже, чем сохранённые 56%. */
const NARROW_VIEWPORT = 1600;
/** Доля чертежа на узком окне: расшифровке остаётся около трети. */
const NARROW_DRAWING_SPLIT = 68;

/**
 * Доля под чертёж. Текст не шире половины окна. На экране до 1600px
 * сохранённую широкую расшифровку поджимаем ещё сильнее.
 */
export function clampPaneSplit(
  saved: number,
  viewportWidth: number,
  kind: "drawing" | "table" = "drawing",
): number {
  let next = saved;
  if (next < 50) next = 50;
  if (
    kind === "drawing" &&
    viewportWidth > 0 &&
    viewportWidth <= NARROW_VIEWPORT &&
    next < NARROW_DRAWING_SPLIT
  ) {
    next = NARROW_DRAWING_SPLIT;
  }
  return Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, next)));
}

/** Границу двигают мышью, поэтому значение приводим к допустимому диапазону. */
export function saveSplit(kind: "drawing" | "table", percent: number) {
  const value = Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, percent)));
  const prefs = loadViewerPrefs();
  saveViewerPrefs(
    kind === "table"
      ? { ...prefs, splitTable: value }
      : { ...prefs, splitDrawing: value },
  );
}

export function loadViewerPrefs(): ViewerPrefs {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ViewerPrefs>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveViewerPrefs(next: ViewerPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // quota / private
  }
}

export function bumpViewerSession(): ViewerPrefs {
  const prefs = loadViewerPrefs();
  if (prefs.hintDismissed) return prefs;
  const next = { ...prefs, sessions: prefs.sessions + 1 };
  saveViewerPrefs(next);
  return next;
}

export function shouldShowViewerHint(prefs: ViewerPrefs): boolean {
  return !prefs.hintDismissed && prefs.sessions <= 3;
}
