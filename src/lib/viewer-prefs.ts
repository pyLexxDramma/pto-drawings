/** Предпочтения вьюера — плотность, жесты, читаемость DWG. */

export type ViewerDensity = "normal" | "compact";
export type CadWheelMode = "zoom" | "pan";
export type CadTextFilter = "all" | "hide" | "text";

export type ViewerPrefs = {
  density: ViewerDensity;
  cadWheel: CadWheelMode;
  largeLabels: boolean;
  thinStrokes: boolean;
  textFilter: CadTextFilter;
  minimap: boolean;
  thumbs: boolean;
  remarks: boolean;
  sessions: number;
  hintDismissed: boolean;
};

const KEY = "pto-viewer-prefs";

const DEFAULTS: ViewerPrefs = {
  density: "normal",
  cadWheel: "zoom",
  largeLabels: true,
  thinStrokes: false,
  textFilter: "all",
  minimap: true,
  thumbs: false,
  remarks: true,
  sessions: 0,
  hintDismissed: false,
};

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
