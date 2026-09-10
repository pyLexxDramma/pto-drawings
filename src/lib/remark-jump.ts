/** Передача фокуса замечания между вкладками (URL режет длинные quote). */
export const REMARK_JUMP_KEY = "pto-remark-jump";

export type RemarkJumpPayload = {
  projectId: string;
  documentId: string;
  page: number;
  reviewId?: string;
  quote?: string;
  /** Откуда открыли — чтобы «Назад» вернул в таблицу замечаний. */
  from?: "reviews";
  at: number;
};

/** На случай Strict Mode: повторный mount не должен потерять payload. */
let memoryJump: RemarkJumpPayload | null = null;

export function saveRemarkJump(payload: Omit<RemarkJumpPayload, "at">) {
  try {
    const full: RemarkJumpPayload = { ...payload, at: Date.now() };
    memoryJump = full;
    // localStorage: новая вкладка из window.open не всегда видит sessionStorage.
    localStorage.setItem(REMARK_JUMP_KEY, JSON.stringify(full));
  } catch {
    // private mode / quota
  }
}

export function takeRemarkJump(): RemarkJumpPayload | null {
  if (memoryJump && Date.now() - memoryJump.at <= 120_000) {
    return memoryJump;
  }
  try {
    const raw = localStorage.getItem(REMARK_JUMP_KEY);
    if (!raw) return null;
    localStorage.removeItem(REMARK_JUMP_KEY);
    const parsed = JSON.parse(raw) as RemarkJumpPayload;
    if (!parsed?.documentId || !parsed.page) return null;
    if (Date.now() - (parsed.at ?? 0) > 120_000) return null;
    memoryJump = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function clearRemarkJump() {
  memoryJump = null;
  try {
    localStorage.removeItem(REMARK_JUMP_KEY);
  } catch {
    // ignore
  }
}

/** Нормализация для сравнения цитаты с расшифровкой/PDF. */
export function normalizeQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u00a0\u202f\u2007]/g, " ")
    .replace(/[«»„“”"'′`]/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
