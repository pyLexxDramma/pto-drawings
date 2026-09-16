/** Сколько сайт должен молчать, прежде чем показать «сервер упал». */
export const SITE_DOWN_AFTER_MS = 30_000;

/** Удачный ответ Next/nginx. Сеть, таймаут, 5xx — сайт не отвечает. */
export function siteAnswered(ok: boolean, status: number | null): boolean {
  if (!ok || status == null) return false;
  return status < 500;
}

export function markSiteProbe(
  prevFailedSince: number | null,
  up: boolean,
  now: number,
): number | null {
  if (up) return null;
  return prevFailedSince ?? now;
}

export function isSiteDown(
  failedSince: number | null,
  now: number,
  thresholdMs = SITE_DOWN_AFTER_MS,
): boolean {
  if (failedSince == null) return false;
  return now - failedSince >= thresholdMs;
}
