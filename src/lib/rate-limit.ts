type Attempt = { count: number; firstAt: number };

const attempts = new Map<string, Attempt>();

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/**
 * Простой счётчик в памяти процесса: цель — остановить перебор пароля,
 * а не построить распределённый лимитер.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const current = attempts.get(key);

  if (!current || now - current.firstAt > windowMs) {
    attempts.set(key, { count: 1, firstAt: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  current.count += 1;
  if (current.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - current.firstAt)) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimit(key: string) {
  attempts.delete(key);
}

export function clientKey(request: Request, suffix: string) {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return `${ip}:${suffix}`;
}
